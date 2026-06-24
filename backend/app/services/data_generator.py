"""Fake data generators — addresses and phone numbers by locale."""
import random

# ── Address data by country ────────────────────────────
_STREET_FORMATS = {
    "US": ("{num} {street} {type}", ["Main", "Oak", "Maple", "Cedar", "Pine", "Elm", "Washington", "Park", "Lake", "Hill", "Sunset", "River", "Spring", "Valley", "Forest"], ["St", "Ave", "Blvd", "Dr", "Ln", "Way", "Rd", "Ct", "Pl"]),
    "UK": ("{num} {street} {type}", ["High", "Church", "Mill", "Manor", "Park", "Victoria", "Station", "Green", "King", "Queen", "London", "Albert", "Bridge", "Rose", "Castle"], ["Street", "Road", "Lane", "Avenue", "Drive", "Close", "Way", "Place", "Crescent"]),
    "DE": ("{street}{type} {num}", ["Haupt", "Bahnhof", "Schiller", "Goethe", "Berliner", "Münchner", "Kirch", "Burg", "Wald", "Berg", "Rosen", "Linden", "Eichen", "Birken", "Tannen"], ["straße", "weg", "allee", "gasse", "ring", "platz"]),
    "FR": ("{num} {type} {street}", ["Victor Hugo", "Pasteur", "République", "Liberté", "Voltaire", "Molière", "Jean Jaurès", "Gambetta", "Clemenceau", "Saint-Martin", "Lafayette", "Montaigne", "De Gaulle"], ["Rue", "Avenue", "Boulevard", "Place", "Allée", "Chemin"]),
    "IT": ("{type} {street} {num}", ["Roma", "Garibaldi", "Mazzini", "Dante", "Verdi", "Marconi", "Cavour", "Matteotti", "Gramsci", "Europa", "Vittorio Emanuele", "San Marco"], ["Via", "Viale", "Piazza", "Corso", "Largo"]),
    "ES": ("{type} {street} {num}", ["Mayor", "Real", "San Antonio", "San José", "Nueva", "La Paz", "Cervantes", "García Lorca", "Gran Vía", "Constitución", "Libertad"], ["Calle", "Avenida", "Plaza", "Paseo", "Camino"]),
    "NL": ("{street}{type} {num}", ["Hoofd", "Kerk", "Dorps", "Markt", "Station", "Molen", "Linden", "Eiken", "Beuk", "Park", "Rijn", "Dam", "Haven"], ["straat", "weg", "laan", "plein", "gracht", "kade"]),
    "BR": ("{type} {street}, {num}", ["XV de Novembro", "São Paulo", "Rio Branco", "Santos Dumont", "Tiradentes", "Dom Pedro", "Independência", "Getúlio Vargas", "Floriano Peixoto"], ["Rua", "Avenida", "Travessa", "Praça", "Alameda"]),
    "AU": ("{num} {street} {type}", ["George", "William", "Elizabeth", "Victoria", "King", "Queen", "Edward", "Albert", "James", "Charles", "Sydney", "Melbourne", "Brisbane"], ["Street", "Road", "Avenue", "Drive", "Place", "Crescent", "Lane", "Way"]),
    "CA": ("{num} {street} {type}", ["Main", "King", "Queen", "Yonge", "Dundas", "Bloor", "Bay", "Front", "Maple", "Oak", "Pine", "Cedar", "Birch", "Elm"], ["Street", "Avenue", "Road", "Drive", "Boulevard", "Lane", "Way", "Crescent"]),
}

_CITIES = {
    "US": [("New York", "NY", "10001"), ("Los Angeles", "CA", "90001"), ("Chicago", "IL", "60601"), ("Houston", "TX", "77001"), ("Phoenix", "AZ", "85001"), ("Philadelphia", "PA", "19101"), ("San Antonio", "TX", "78201"), ("San Diego", "CA", "92101"), ("Dallas", "TX", "75201"), ("Austin", "TX", "73301"), ("Denver", "CO", "80201"), ("Portland", "OR", "97201"), ("Seattle", "WA", "98101"), ("Miami", "FL", "33101"), ("Atlanta", "GA", "30301")],
    "UK": [("London", "", "SW1A 1AA"), ("Manchester", "", "M1 1AA"), ("Birmingham", "", "B1 1AA"), ("Leeds", "", "LS1 1BA"), ("Glasgow", "", "G1 1AA"), ("Liverpool", "", "L1 1AA"), ("Bristol", "", "BS1 1AA"), ("Edinburgh", "", "EH1 1AA"), ("Cardiff", "", "CF10 1AA"), ("Belfast", "", "BT1 1AA")],
    "DE": [("Berlin", "BE", "10115"), ("München", "BY", "80331"), ("Hamburg", "HH", "20095"), ("Köln", "NW", "50667"), ("Frankfurt", "HE", "60311"), ("Stuttgart", "BW", "70173"), ("Düsseldorf", "NW", "40210"), ("Dresden", "SN", "01067"), ("Leipzig", "SN", "04109"), ("Hannover", "NI", "30159")],
    "FR": [("Paris", "", "75001"), ("Marseille", "", "13001"), ("Lyon", "", "69001"), ("Toulouse", "", "31000"), ("Nice", "", "06000"), ("Nantes", "", "44000"), ("Strasbourg", "", "67000"), ("Montpellier", "", "34000"), ("Bordeaux", "", "33000"), ("Lille", "", "59000")],
    "IT": [("Roma", "RM", "00100"), ("Milano", "MI", "20121"), ("Napoli", "NA", "80121"), ("Torino", "TO", "10121"), ("Firenze", "FI", "50121"), ("Bologna", "BO", "40121"), ("Venezia", "VE", "30121"), ("Genova", "GE", "16121"), ("Palermo", "PA", "90121"), ("Bari", "BA", "70121")],
    "ES": [("Madrid", "", "28001"), ("Barcelona", "", "08001"), ("Valencia", "", "46001"), ("Sevilla", "", "41001"), ("Zaragoza", "", "50001"), ("Málaga", "", "29001"), ("Bilbao", "", "48001"), ("Murcia", "", "30001"), ("Palma", "", "07001"), ("Granada", "", "18001")],
    "NL": [("Amsterdam", "", "1011"), ("Rotterdam", "", "3011"), ("Den Haag", "", "2511"), ("Utrecht", "", "3511"), ("Eindhoven", "", "5611"), ("Groningen", "", "9711"), ("Tilburg", "", "5000"), ("Almere", "", "1300"), ("Breda", "", "4800"), ("Arnhem", "", "6811")],
    "BR": [("São Paulo", "SP", "01001-000"), ("Rio de Janeiro", "RJ", "20001-000"), ("Brasília", "DF", "70001-000"), ("Salvador", "BA", "40001-000"), ("Belo Horizonte", "MG", "30001-000"), ("Fortaleza", "CE", "60001-000"), ("Curitiba", "PR", "80001-000"), ("Recife", "PE", "50001-000"), ("Manaus", "AM", "69001-000"), ("Porto Alegre", "RS", "90001-000")],
    "AU": [("Sydney", "NSW", "2000"), ("Melbourne", "VIC", "3000"), ("Brisbane", "QLD", "4000"), ("Perth", "WA", "6000"), ("Adelaide", "SA", "5000"), ("Canberra", "ACT", "2600"), ("Hobart", "TAS", "7000"), ("Darwin", "NT", "0800"), ("Gold Coast", "QLD", "4217"), ("Newcastle", "NSW", "2300")],
    "CA": [("Toronto", "ON", "M5A 1A1"), ("Montreal", "QC", "H1A 1A1"), ("Vancouver", "BC", "V5A 1A1"), ("Calgary", "AB", "T1A 1A1"), ("Ottawa", "ON", "K1A 0A1"), ("Edmonton", "AB", "T5A 0A1"), ("Winnipeg", "MB", "R2C 0A1"), ("Quebec City", "QC", "G1A 1A1"), ("Halifax", "NS", "B3H 1A1"), ("Victoria", "BC", "V8V 1A1")],
}

_COUNTRY_NAMES = {
    "US": "United States", "UK": "United Kingdom", "DE": "Germany",
    "FR": "France", "IT": "Italy", "ES": "Spain", "NL": "Netherlands",
    "BR": "Brazil", "AU": "Australia", "CA": "Canada",
}

SUPPORTED_COUNTRIES = list(_COUNTRY_NAMES.keys())


def generate_address(country: str = "US") -> dict:
    """Generate a realistic fake address for the given country."""
    country = country.upper()
    if country not in _STREET_FORMATS:
        country = "US"

    fmt, streets, types = _STREET_FORMATS[country]
    num = random.randint(1, 9999)
    street = random.choice(streets)
    stype = random.choice(types)
    street_line = fmt.format(num=num, street=street, type=stype)

    city, state, postal = random.choice(_CITIES[country])

    # Build formatted address
    if country == "US":
        full = f"{street_line}, {city}, {state} {postal}"
    elif country == "UK":
        full = f"{street_line}, {city}, {postal}"
    elif country == "DE":
        full = f"{street_line}, {postal} {city}"
    elif country == "FR":
        full = f"{street_line}, {postal} {city}"
    elif country == "IT":
        full = f"{street_line}, {postal} {city} {state}"
    elif country == "ES":
        full = f"{street_line}, {postal} {city}"
    elif country == "NL":
        full = f"{street_line}, {postal} {city}"
    elif country == "BR":
        full = f"{street_line} - {city}, {state}, {postal}"
    elif country == "AU":
        full = f"{street_line}, {city} {state} {postal}"
    elif country == "CA":
        full = f"{street_line}, {city}, {state} {postal}"
    else:
        full = f"{street_line}, {city} {postal}"

    return {
        "street": street_line,
        "city": city,
        "state": state,
        "postal_code": postal,
        "country": _COUNTRY_NAMES.get(country, country),
        "country_code": country,
        "formatted": full,
    }


# ── Phone number patterns by country ──────────────────

_PHONE_FORMATS = {
    "US": ("+1", "(XXX) XXX-XXXX", 10),
    "UK": ("+44", "XXXX XXXXXX", 10),
    "DE": ("+49", "XXX XXXXXXXX", 11),
    "FR": ("+33", "X XX XX XX XX", 9),
    "IT": ("+39", "XXX XXX XXXX", 10),
    "ES": ("+34", "XXX XXX XXX", 9),
    "NL": ("+31", "XX XXX XXXX", 9),
    "BR": ("+55", "(XX) XXXXX-XXXX", 11),
    "AU": ("+61", "XXX XXX XXX", 9),
    "CA": ("+1", "(XXX) XXX-XXXX", 10),
}

# Area codes to make numbers look real
_AREA_CODES = {
    "US": ["212", "310", "312", "404", "415", "512", "617", "702", "713", "786", "818", "901", "917"],
    "UK": ["020", "0121", "0131", "0141", "0161", "0113", "0114", "0115", "0116", "0117"],
    "DE": ["030", "040", "069", "089", "0211", "0221", "0341", "0351", "0511", "0711"],
    "FR": ["1", "4", "5", "6", "7"],
    "IT": ["02", "06", "011", "055", "081", "091", "041", "051", "010"],
    "ES": ["91", "93", "95", "96", "94", "92", "98", "97"],
    "NL": ["20", "10", "70", "30", "40", "50"],
    "BR": ["11", "21", "31", "41", "51", "61", "71", "81", "85", "92"],
    "AU": ["02", "03", "04", "07", "08"],
    "CA": ["416", "514", "604", "403", "613", "780", "204", "418", "902", "250"],
}


def generate_phone(country: str = "US") -> dict:
    """Generate a realistic fake phone number for the given country."""
    country = country.upper()
    if country not in _PHONE_FORMATS:
        country = "US"

    prefix, fmt, digits = _PHONE_FORMATS[country]
    area_codes = _AREA_CODES.get(country, [""])
    area_code = random.choice(area_codes)

    # Generate remaining digits
    remaining = digits - len(area_code.replace("0", "").replace(" ", ""))
    number_digits = area_code + "".join([str(random.randint(0, 9)) for _ in range(remaining + 2)])

    # Format the number
    result = ""
    digit_idx = 0
    for char in fmt:
        if char == "X":
            if digit_idx < len(number_digits):
                result += number_digits[digit_idx]
                digit_idx += 1
            else:
                result += str(random.randint(0, 9))
        else:
            result += char

    return {
        "number": result,
        "country_code": prefix,
        "country": _COUNTRY_NAMES.get(country, country),
        "formatted": f"{prefix} {result}",
    }
