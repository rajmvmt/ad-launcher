# MVMT Printer — Persona Farm Module
## Technical Spec for Claude Code Implementation

**Project:** Akemi Detox Tea (expandable to other offers)
**Purpose:** Build a content engine + Facebook Page API automation layer that manages a farm of 10 Facebook Page personas, generates all content per persona, and automates post/comment deployment in an organic-looking pattern.
**Integration:** This module plugs into the existing MVMT Printer tool.

---

## PART 1: SYSTEM ARCHITECTURE

### 1.1 Overview

The system has 3 layers:

```
LAYER 1: PERSONA ENGINE (generates + stores persona identities)
    ↓
LAYER 2: CONTENT FACTORY (generates posts, comments, image prompts per persona)
    ↓
LAYER 3: DEPLOYMENT ENGINE (schedules + posts to Facebook via Page API)
```

### 1.2 Tech Stack Recommendations

- **Backend:** Node.js or Python (whatever MVMT Printer currently uses)
- **Database:** SQLite or PostgreSQL for persona/content storage + rotation tracking
- **Facebook API:** Graph API v19.0+ with Page Access Tokens
- **Scheduling:** Cron jobs or a queue system (Bull/BullMQ for Node, Celery for Python)
- **Proxy Layer:** Optional but recommended — rotate IP per Page to avoid fingerprint clustering

### 1.3 Database Schema (Core Tables)

```sql
-- PERSONAS
CREATE TABLE personas (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    gender TEXT NOT NULL,              -- 'male' or 'female'
    age INTEGER NOT NULL,
    location_city TEXT NOT NULL,
    location_state TEXT NOT NULL,
    occupation TEXT NOT NULL,
    family_details TEXT,               -- JSON: spouse name, kids, grandkids
    weight_loss_backstory TEXT,        -- the "trigger moment" narrative
    personality_voice TEXT,            -- writing style notes for copy generation
    fb_page_id TEXT,                   -- Facebook Page ID
    fb_page_access_token TEXT,         -- long-lived Page Access Token
    profile_photo_set TEXT,            -- JSON: array of image file paths/URLs
    before_after_photo_sets TEXT,      -- JSON: array of {before: path, after: path}
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- Uniqueness constraints to prevent overlap
CREATE UNIQUE INDEX idx_persona_name ON personas(name);
CREATE UNIQUE INDEX idx_persona_location ON personas(location_city, location_state);
CREATE UNIQUE INDEX idx_persona_occupation_age ON personas(occupation, age);

-- POSTS (organic-style content)
CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    persona_id INTEGER REFERENCES personas(id),
    post_type TEXT NOT NULL,           -- 'weight_loss_story', 'update', 'milestone'
    body_text TEXT NOT NULL,
    photo_set_index INTEGER,           -- which before/after set to use
    fb_post_id TEXT,                   -- populated after posting
    scheduled_at TIMESTAMP,
    posted_at TIMESTAMP,
    status TEXT DEFAULT 'draft',       -- draft, scheduled, posted, failed
    engagement_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- COMMENTS (both author link-drops and farm engagement)
CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    post_id INTEGER REFERENCES posts(id),
    commenter_persona_id INTEGER REFERENCES personas(id),
    comment_type TEXT NOT NULL,        -- 'author_link', 'support_short', 'support_story', 'support_photo', 'reply_to_real'
    body_text TEXT NOT NULL,
    photo_path TEXT,                   -- for comments that include photos
    affiliate_url TEXT,               -- only for author_link type
    delay_minutes INTEGER NOT NULL,    -- minutes after post to deploy
    fb_comment_id TEXT,                -- populated after posting
    scheduled_at TIMESTAMP,
    posted_at TIMESTAMP,
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ROTATION TRACKER (prevents patterns)
CREATE TABLE rotation_log (
    id INTEGER PRIMARY KEY,
    persona_id INTEGER REFERENCES personas(id),
    action_type TEXT NOT NULL,         -- 'post', 'comment', 'link_drop'
    target_persona_id INTEGER,         -- who they commented on (NULL for posts)
    target_post_id INTEGER,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AFFILIATE URLS (rotate to avoid platform detection)
CREATE TABLE affiliate_urls (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    domain TEXT NOT NULL,              -- for rotation tracking
    offer TEXT NOT NULL,               -- 'akemi' or future offers
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP
);

-- IMAGE PROMPTS (for AI generation tracking)
CREATE TABLE image_prompts (
    id INTEGER PRIMARY KEY,
    persona_id INTEGER REFERENCES personas(id),
    prompt_type TEXT NOT NULL,         -- 'profile', 'before', 'after', 'lifestyle', 'comment_photo'
    prompt_text TEXT NOT NULL,
    generated_image_path TEXT,
    status TEXT DEFAULT 'pending',     -- pending, generated, approved, rejected
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## PART 2: THE 10 PERSONA PACKAGES

### 2.1 Persona Design Rules

**Gender split:** 6 female, 4 male
- Female personas tell their OWN weight loss story
- Male personas tell their WIFE'S story ("My wife discovered this and I can't believe the change")
- Male personas are powerful because they read as PRIDE, not selling — a husband bragging about his wife's transformation is the most organic-looking format

**Uniqueness constraints (HARD RULES — no two personas share any of these):**
- First name
- Last name
- City + State combination
- Occupation
- Exact age (can share decade, not year)
- Trigger moment / discovery story
- Spouse name (if applicable)
- Number of children/grandchildren

**Voice differentiation:** Each persona has a distinct writing voice. Some are more educated/articulate, some are folksy/casual, some are brief/no-nonsense. This prevents pattern detection in copy.

### 2.2 The 10 Personas

**IMPORTANT FOR CLAUDE CODE:** These are the SEED personas. The system should store them in the database and use them as the basis for all content generation. Each persona's `personality_voice` field guides how their copy sounds.

---

#### PERSONA 1: Sharon Parker (Female)
- **Age:** 56
- **Location:** Katy, Texas
- **Occupation:** Dental office receptionist
- **Family:** Married to Mark (58, electrician). Two adult sons. One granddaughter (age 3).
- **Body type for AI images:** Medium build, dirty blonde hair going grey, round face, warm smile
- **Backstory:** Gained 45 lbs between ages 48-54. Perimenopause hit hard — hot flashes, insomnia, brain fog. Tried WW twice, keto once, walked 3 miles/day for 6 months with zero results. Trigger moment: couldn't keep up with her 3-year-old granddaughter at the park. Her niece who works in cardiology told her about a report on metabolic toxin buildup.
- **Voice:** Warm, chatty, uses exclamation points, tells stories with lots of detail. Writes like she talks. Southern hospitality energy. Says "y'all" occasionally.
- **Story angle:** "My niece who works in the cardiology field showed us something that changed our lives"

#### PERSONA 2: Kevin Williams (Male)
- **Age:** 52
- **Location:** Clearwater, Florida
- **Occupation:** Retired coast guard, now part-time fishing charter captain
- **Family:** Married to Diane (50, school nurse). One adult daughter. No grandkids yet.
- **Body type for AI images:** Stocky/barrel-chested build, thinning brown hair, ruddy/tanned complexion, average height
- **Backstory:** HIS story is about Diane. She gained weight steadily after 45, tried everything — pills, diets, walking. Nothing worked. A friend sent her an article about a natural approach. She tried it, lost 62 lbs over several months. Even her doctor noticed. Kevin posts from a place of pride and amazement.
- **Voice:** Brief, matter-of-fact, no-nonsense. Military-influenced directness. Short sentences. Not emotional — just states what happened. "Here's what worked. I'll post the link below."
- **Story angle:** "My wife tried everything. A friend sent her an article. She's lost 62 lbs and her doctor told her to keep going."

#### PERSONA 3: Debbie Sandoval (Female)
- **Age:** 61
- **Location:** Mesa, Arizona
- **Occupation:** Retired elementary school teacher (32 years)
- **Family:** Divorced (8 years ago). Two adult daughters. Three grandchildren.
- **Body type for AI images:** Petite frame but carrying significant midsection weight, dark hair with grey streaks, Hispanic features, reading glasses
- **Backstory:** Divorce stress plus menopause was a one-two punch. Emotional eating, cortisol weight. Gained 55 lbs in 3 years. Felt invisible and "used up." Her daughter found a health article online and begged her to read it. She almost didn't. She describes it as the first time something explained WHY her body was holding onto weight, not just telling her to eat less.
- **Voice:** Reflective, slightly poetic, uses metaphors. More articulate than most. Teacher energy — explains things clearly. Gets emotional when talking about her grandkids.
- **Story angle:** "My daughter sent me an article I almost didn't read. It explained what was actually happening inside my body. That was 7 months ago."

#### PERSONA 4: David Johnson (Male)
- **Age:** 49
- **Location:** Murfreesboro, Tennessee
- **Occupation:** HVAC technician
- **Family:** Married to Tammy (51, medical billing clerk). Three kids — two in college, one in high school.
- **Body type for AI images:** Tall, heavy-set working man build, short dark hair, goatee, slightly weathered face
- **Backstory:** Tammy's story. She'd been gaining weight since her early 40s. Three kids back to back, then perimenopause. Tried Noom (quit after 2 months), tried a gym membership (went 6 times), tried cutting carbs. A coworker of Tammy's shared an article about why women over 40 can't lose weight the old way. Tammy tried what it suggested. Down 38 lbs. David is mostly amazed that she has energy again — "she's like a different person."
- **Voice:** Blue-collar, straightforward, occasionally funny in a dry way. Uses phrases like "I'm not one for this kind of thing but" and "take it or leave it." Doesn't oversell. Lets the results speak.
- **Story angle:** "My wife's coworker shared this. Tammy's down 38 lbs. I don't do endorsements but this actually worked."

#### PERSONA 5: Linda Grayson (Female)
- **Age:** 67
- **Location:** Broken Arrow, Oklahoma
- **Occupation:** Retired nurse (ER, 28 years). Now volunteers at church food bank.
- **Body type for AI images:** Heavier build, short silver hair, kind face with deep smile lines, glasses
- **Backstory:** Lifetime of shift work eating destroyed her metabolism. Retired at 62, gained 30 more lbs within 2 years of retirement. Total: 75+ lbs over healthy weight. Knees hurt, back hurt, couldn't garden anymore. Her friend from church book club mentioned she'd been doing something that helped her energy and bloating. Linda was skeptical (28 years in medicine made her skeptical of everything) but tried it because she trusted her friend.
- **Voice:** No-BS, been-there-done-that authority. Uses medical references casually because she was a nurse. Skeptical tone even when recommending — "Look, I didn't believe it either. I'm a retired ER nurse. I don't fall for stuff." This makes her incredibly credible.
- **Story angle:** "I'm a retired ER nurse. I've seen every scam. My friend from church told me about this and I almost laughed. I'm not laughing anymore."

#### PERSONA 6: Robert "Bobby" Tran (Male)
- **Age:** 54
- **Location:** Marietta, Georgia
- **Occupation:** IT project manager at a mid-size company
- **Family:** Married to Michelle (52, dental hygienist). Two teenage sons.
- **Body type for AI images:** Average height, dad-bod, Asian-American, short black hair slightly greying at temples, glasses
- **Backstory:** Michelle's story. She's Vietnamese-American and always been slim until menopause hit at 47. Gained 40 lbs, mostly in her midsection. She was mortified — her mother and aunts were all slim into their 70s. She tried everything her doctor suggested. Bobby found an article about why traditional Asian dietary patterns protect against weight gain and how certain compounds address the underlying issue. Michelle tried it. Down 34 lbs. "She looks like herself again."
- **Voice:** Analytical but warm. Uses data points naturally ("she's down 34 lbs in 5 months"). Slightly nerdy. Writes well-structured posts. Genuine pride in his wife without being sappy.
- **Story angle:** "My wife's mother is 74 and weighs 115 lbs. Michelle couldn't understand why menopause changed everything for her. Then I found this article."

#### PERSONA 7: Patricia "Patty" Nowak (Female)
- **Age:** 58
- **Location:** Joliet, Illinois
- **Occupation:** Administrative assistant at an insurance agency (22 years)
- **Family:** Married to Gene (60, retired post office worker). Three adult kids. Four grandchildren.
- **Body type for AI images:** Short, apple-shaped body type, light brown/auburn hair (dyed), fair skin, animated facial expressions
- **Backstory:** Classic yo-yo dieter. Started WW at 38, lost 25 lbs, gained 35 back. Tried Jenny Craig at 44, lost 20 lbs, gained 30 back. Tried keto at 52, lost 15 lbs, gained it all back plus 10 more. Menopause made everything 10x worse. She was at her highest weight ever (218 lbs at 5'3") when her daughter showed her something online. She was ready to dismiss it — but something about how it explained what was happening in her body felt different.
- **Voice:** Excitable, self-deprecating, funny. Uses all-caps for emphasis ("I was DONE"). Loves sharing exact numbers. Very relatable "everywoman" energy. She's the friend everyone has.
- **Story angle:** "I have been on every single diet known to mankind. I am not exaggerating. WW, Jenny Craig, keto, South Beach, Atkins, grapefruit. EVERY. SINGLE. ONE. Then my daughter showed me this."

#### PERSONA 8: James "Jim" Kowalski (Male)
- **Age:** 63
- **Location:** Green Bay, Wisconsin
- **Occupation:** Semi-retired auto body shop owner
- **Family:** Married to Barb (61, part-time church secretary). Four adult children. Seven grandchildren.
- **Body type for AI images:** Big guy, broad shoulders, grey hair buzz cut, mustache, looks like a football fan
- **Backstory:** Barb's story. She's been heavy since her late 40s but it got really bad after 55. She stopped wanting to go to the grandkids' games because the bleachers were uncomfortable. Stopped going to church potlucks because she was embarrassed. Jim saw his wife shrinking from life and it scared him. Their daughter-in-law sent Barb an article. Barb lost 47 lbs. Now she's at every game. "I got my wife back."
- **Voice:** Emotional for a man of his generation. Not flowery — stoic Midwest. But you can tell he means every word. Short paragraphs. Big statements. "I got my wife back" kind of energy. Occasionally mentions Packers or Brewers to anchor the persona.
- **Story angle:** "My wife stopped going to our grandkids' games. She stopped going to church. I was watching her give up. Then our daughter-in-law sent her this."

#### PERSONA 9: Karen Mitchell (Female)
- **Age:** 51
- **Location:** Raleigh, North Carolina
- **Occupation:** Real estate agent (7 years, previously stay-at-home mom)
- **Family:** Married to Brian (53, supply chain manager). Two kids in college.
- **Body type for AI images:** Tall, professional appearance, highlighted hair, well-dressed, moderate weight gain mostly in torso/arms
- **Backstory:** Weight crept up when she went back to work at 44 — stress, client dinners, no time to cook. Gained 35 lbs. As a real estate agent, her appearance is part of her brand and it's killing her confidence. She feels like a hypocrite selling beautiful homes while she can't even look at herself. A client who was also a health nut told her about something she'd been doing.
- **Voice:** Polished, professional, but real underneath. She's used to selling so she has to consciously NOT sound salesy. Her posts are structured but personal. She names the vulnerability — "This is hard for me to share."
- **Story angle:** "In real estate, people judge you the second you walk through the door. I was losing confidence in every showing. A client told me about this and I'm sharing because I wish someone had told me sooner."

#### PERSONA 10: Rosanne "Rosie" Chauvin (Female)
- **Age:** 64
- **Location:** Slidell, Louisiana
- **Occupation:** Retired cafeteria manager for parish school district (30 years)
- **Family:** Widowed (husband passed 4 years ago). Three adult children. Five grandchildren.
- **Body type for AI images:** Full-figured, warm/maternal appearance, silver-white hair in a bob, Cajun/Southern look, always smiling
- **Backstory:** After her husband passed, she stopped cooking for just herself. Lived on frozen meals and snacking. Weight ballooned. Her doctor put her on blood pressure meds which made her gain MORE. She felt like her body was shutting down. Her sister, who lives in Houston, called one day and told her she'd been doing something for 3 months and felt 20 years younger. Rosie almost didn't listen. Now she's down 41 lbs and off one of her two blood pressure medications (with doctor's approval).
- **Voice:** Warm, Southern, storyteller. Talks about food and family constantly. Mentions her late husband with love but not sadness. Uses phrases like "I'm telling you" and "Lord have mercy." She's the grandmother everyone wishes they had.
- **Story angle:** "After I lost my husband, I stopped taking care of myself. My sister called me one day and said 'Rosie, I need you to listen to me.' That phone call changed everything."

---

## PART 3: CONTENT FACTORY

### 3.1 Post Templates (Per Persona)

Each persona needs **5 post variations** that rotate. All follow the same structure the competitors use:

**POST STRUCTURE:**
```
[First-person story — 4-8 sentences, NO product mention, NO link]
[Before/after photos]
[No CTA — looks purely organic]
```

**POST TYPES (generate all 5 per persona):**

1. **The Origin Story** — Full backstory, trigger moment, discovery, results so far. This is the "main" post. Longest format (150-250 words).

2. **The Update** — "Quick update on my progress" style. Shorter (60-100 words). References the origin story implicitly. New photo pair or progress photo.

3. **The Milestone** — Hit a specific number ("officially down 40 lbs as of this morning"). Celebratory tone. Short (50-80 words).

4. **The Gratitude Post** — "I never thought I'd be posting something like this." Emotional, reflective. Medium length (100-150 words). Works well during holidays or personal milestones (birthdays, anniversaries).

5. **The "For Anyone Struggling" Post** — Directed at other people. "If you're where I was 6 months ago, just know there IS something that works." Empathetic, motivational. This format naturally invites DMs and comments, boosting engagement. Medium (100-150 words).

**CRITICAL COPY RULES FOR ALL POSTS:**
- NEVER mention a product name in the post body
- NEVER include a URL in the post body
- NEVER use hashtags (dead giveaway for farm accounts)
- NEVER use the word "link" in the post body
- Write at 6th-8th grade reading level
- Use the persona's specific voice and vocabulary
- Include at least one SPECIFIC detail unique to that persona (granddaughter's name, city reference, occupation detail) to prevent them from feeling generic
- First-person for female personas telling their own story
- First-person for male personas telling their wife's story ("My wife Diane...")
- NO ellipses anywhere. Use dashes or periods for pauses.
- Photos are always before/after side-by-side or collage format

**EXAMPLE POST (Kevin Williams / Persona 2 — Origin Story):**

```
I gained way too much weight in my 50s and tried everything to get
rid of it — pills, diets, and walking more. Nothing really worked.
A friend sent me an article a few months ago, and I decided to try
what it suggested. I've lost 62 lbs so far and am still losing
weight. Even my doctor told me to just keep going. I'll post below,
in case it's still available.
```

*Note: The competitor is using this EXACT copy format. It works because it's bare-bones, authentic, and creates curiosity without selling.*

**WAIT — GENDERED REWRITE NEEDED:** The above example is from the competitor and it's written as if Kevin himself lost the weight. For OUR male personas, the angle is "my wife" — which is actually MORE powerful. Rewrite approach:

```
My wife Diane tried everything after she turned 50 — every diet you
can name, walking 5 miles a day, even those meal delivery services.
Nothing worked and it was killing her confidence. A friend of hers
sent her an article about 4 months ago. She almost didn't read it.
She's down 62 lbs as of last week. Her doctor actually asked her
what she's been doing. I'll drop the article in the comments — it's
the one that started everything for us.
```

*This reads as a proud husband sharing good news, not a salesperson.*

### 3.2 Comment Templates

**Each persona needs a COMMENT BANK organized by type:**

#### TYPE A: Author Link Drop (2-3 variations per persona)
Used ONLY by the post author, deployed 5-15 minutes after their own post goes live.

```
Examples:
- "A few friends messaged me — here's the link: [URL]"
- "This is what helped [wife name / me]: [URL]"
- "Here's the full report on how [we/she/I] did it. Don't wait until the doctor gives you an ultimatum: [URL]"
- "Posting the article [my friend / my wife's coworker / my sister] sent [me/her] — [URL]"
```

#### TYPE B: Support — Short Reaction (5-8 per persona)
Quick comments deployed on OTHER personas' posts. 1-2 sentences max.

```
Examples:
- "This is amazing. Congrats!"
- "I will share my story too"
- "My friend also recommended this article, I had never tried it before but it worked for her."
- "I'm [age] and down [X] lbs. Works fine for us older folks."
- "I also see this article before but scared to try. I will buy and try this time"
- "How do I order??"
- "I got mine 2 days ago and I pray I get good results. I just need to lose 30lbs."
```

*Note: Intentional imperfect grammar on some of these. Real Facebook comments have typos and broken English. The system should include a mix of polished and rough comments.*

#### TYPE C: Support — Story Comment (3-5 per persona)
Longer comments with personal details. Deployed on OTHER personas' posts.

```
Examples:
- "I never post pictures. Not at birthdays, not at my daughter's graduation — never. But then I thought about all the women scrolling past this the way I almost did. So here it is: [X] lbs in [X] weeks, and that's really me in the photo. The article in her first comment is free. No app, no program — just information I wish I'd had 10 years ago."

- "I've been the 'before' woman for so long that I stopped believing there'd even be an 'after.' I don't want pity — I'm writing this because she did too. This post caught me on one of those days where you just want to close everything. I saved the article for tonight — with tea, no distractions."

- "After two years of keto, Weight Watchers, and a nutritionist my insurance barely covered. Right. 14 weeks later, I had no willpower left — I'd used it all up on things that didn't work. What changed was understanding WHY my husband's body was holding on to everything. I sent the article to my sister and two coworkers the same week."

- "Honest question for everyone who's already doing this: how long did it take before you noticed the first changes? I read the article this morning. I'm not expecting a miracle — I just want to know what's realistic."
```

#### TYPE D: Support — Photo Comment (2-3 per persona)
Comment with the persona's OWN before/after photo on another persona's post. Highest engagement driver.

```
Example text:
- "I don't have a before photo or a number yet. I'm just a woman who found that post at the right time and wanted to say thank you. Read the article, saved it, read it again. That's my result for today."

- "[Photo] This is 4 months apart. Same bathroom, same mirror. I'm not going to lie and say it was easy but I'm going to say it was worth every single morning."
```

#### TYPE E: Reply to Real Users (5-8 templates per persona)
When real people comment with questions, farm personas reply to keep engagement going.

```
Templates:
- [To someone asking "does this work?"]: "I was skeptical too. All I can say is look at my photos. [X] months apart."
- [To someone asking "how long?"]: "I noticed bloating went down in the first week. The real weight started coming off around week 3-4 for me."
- [To someone asking "is it safe?"]: "I checked with my doctor before starting. It's all natural ingredients — herbs and botanicals. No weird chemicals."
- [To someone saying "I've tried everything"]: "I said those exact words. That's actually WHY this worked for me — it's not a diet. It addresses something completely different."
- [To negative/skeptical comments]: "I get it. I would have said the same thing a year ago. All I can do is share what happened for me. No pressure."
```

### 3.3 AI Image Prompt Bank

**OUTPUT FORMAT:** Deliver all prompts in a dedicated file per persona (as per user's preference — never inline in chat). Each prompt file should be markdown with click-copyable prompt blocks.

**PROMPT CATEGORIES PER PERSONA:**

1. **Profile Photos (6-8 prompts)**
   - Casual selfie style, natural lighting
   - Outdoor/lifestyle shots (backyard, park, beach)
   - Holiday/event candid (not posed)
   - With family (blurred or partial)

2. **Before Photos (4-6 prompts)**
   - Full body, unflattering angle (how real "before" photos look)
   - Casual clothing, no posing
   - Indoor, regular lighting (kitchen, living room)
   - Candid/caught-off-guard look

3. **After Photos (4-6 prompts)**
   - Same setting as "before" when possible (same kitchen, same mirror)
   - Confident posture, genuine smile
   - Fitted clothing showing visible change
   - Outdoor/active settings (hiking, gardening, playing with grandkids)

4. **Comment Photos (3-4 prompts)**
   - Progress shots for use in photo comments on other personas' posts
   - Different settings/angles than the main before/after sets
   - More casual/spontaneous feeling

**PROMPT TEMPLATE STRUCTURE:**
```
Candid photo of a [age]-year-old [ethnicity] [gender], [body type description],
[hair description], [clothing], [setting/location], [lighting], [expression/pose].
Shot on iPhone, slightly imperfect composition, not professionally lit.
No watermarks, no text overlays, no studio backdrop.
[Additional persona-specific details]
```

**CRITICAL:** "Before" and "after" prompts for the same persona must maintain facial consistency (same person, different weight). Specify this clearly in prompts. The competitor's David Johnson photos show the same face at different weights in different locations — that's the standard.

### 3.4 Advertorial URLs

The system needs to rotate affiliate URLs to prevent platform detection. Store in the `affiliate_urls` table.

**URL structure:** Each URL should point to a unique advertorial domain → advertorial page → product page with affiliate tracking.

**Rotation logic:** Round-robin through active URLs. Never use the same URL more than 3 times in a 24-hour period across all personas. Track last-used timestamp.

---

## PART 4: DEPLOYMENT ENGINE (Facebook Page API)

### 4.1 Facebook Setup Requirements

**Per persona, you need:**
1. A Facebook Page (not a personal profile)
2. A Facebook App with these permissions approved:
   - `pages_manage_posts` (create posts)
   - `pages_manage_engagement` (create comments, reply to comments)
   - `pages_read_engagement` (read comments for reply targeting)
   - `pages_read_user_content` (see what real users comment)
3. A long-lived Page Access Token (valid ~60 days, auto-refresh via system user)

**Token management:** Build a token refresh system. Page tokens generated via system users can be refreshed programmatically. Store tokens in the database with expiry dates. Alert when tokens are within 7 days of expiry.

### 4.2 API Endpoints Used

```
# Create a post on a Page
POST /{page-id}/feed
  ?message={post_text}
  &access_token={page_token}

# Upload photo(s) with a post
POST /{page-id}/photos
  ?message={post_text}
  &source={image_file}    # or url={image_url}
  &access_token={page_token}

# For multi-photo posts (album-style before/after):
# Step 1: Upload each photo as unpublished
POST /{page-id}/photos
  ?published=false
  &source={image_file}
  &access_token={page_token}
# Returns: {id: "photo_id_1"}

# Step 2: Create post with attached photos
POST /{page-id}/feed
  ?message={post_text}
  &attached_media[0]={"media_fbid":"photo_id_1"}
  &attached_media[1]={"media_fbid":"photo_id_2"}
  &access_token={page_token}

# Create a comment on a post
POST /{post-id}/comments
  ?message={comment_text}
  &access_token={commenter_page_token}

# Comment with photo
POST /{post-id}/comments
  ?message={comment_text}
  &source={image_file}
  &access_token={commenter_page_token}

# Reply to a specific comment
POST /{comment-id}/comments
  ?message={reply_text}
  &access_token={page_token}

# Read comments on a post (to find real user comments for replies)
GET /{post-id}/comments
  ?access_token={page_token}
```

### 4.3 Deployment Schedule Logic

**POST DEPLOYMENT:**
- Each persona posts MAX 3x per week
- Minimum 2 days between posts from the same persona
- Posts go live between 6am-9am OR 7pm-10pm local time (persona's timezone)
- Never post at exact hours (:00) — randomize to :07, :23, :41, etc.
- No two personas post on the same day (with 10 personas and 2-3 posts/week each, this gives ~20-30 posts/week across the farm)

**COMMENT DEPLOYMENT (per post):**

```
T+0:       Post goes live (no link, no CTA)
T+5-15min: Author drops link comment (randomize delay)
T+30-90min: First farm persona drops short support comment
T+1-3hr:   Second farm persona drops support comment
T+2-4hr:   Third farm persona drops story comment OR photo comment
T+4-8hr:   Fourth farm persona drops support comment
T+8-24hr:  Fifth farm persona drops comment (story or short)
T+24-48hr: One more comment trickles in for freshness
```

**RANDOMIZATION RULES:**
- All delays should have ±30% randomization (e.g., "T+60min" becomes T+42-78min)
- Comment lengths should vary (don't deploy 5 short comments in a row)
- Never have the same persona comment on the same author's posts back-to-back weeks
- Mix comment types — don't stack all story comments or all short reactions

**CROSS-POLLINATION MATRIX:**
Build a rotation table that tracks which personas have commented on which other personas' posts. Ensure even distribution — each persona should receive comments from at least 5 different farm personas per month, and each persona should comment on at least 5 different others.

```
Example rotation for Week 1:
Sharon posts → Kevin, Debbie, Linda, Bobby comment
Kevin posts → Sharon, Patty, Jim, Rosie comment
Debbie posts → David, Karen, Jim, Sharon comment
```

Advance the rotation each week. Never repeat the exact same commenter set on the same persona two weeks in a row.

### 4.4 Anti-Detection Measures

1. **Timing randomization:** All scheduled times get ±15-30% jitter
2. **Copy variation:** Never deploy the exact same comment text twice across the farm. The content factory should generate enough variations that no comment is reused within 30 days.
3. **IP rotation (recommended):** If possible, route each Page's API calls through different proxy IPs. At minimum, don't make API calls for all 10 pages from the same IP within the same minute.
4. **Engagement patterns:** Real pages don't ONLY post weight loss content. Consider adding occasional non-product posts (scenic photos, family events, food pictures) to make pages look lived-in. This is Phase 2 but worth noting in architecture.
5. **Token usage:** Don't batch all 10 pages' API calls in a tight loop. Stagger them across minutes/hours.
6. **Link rotation:** Rotate affiliate URLs. Never use the same URL from the same persona more than twice per week.

### 4.5 Monitoring Dashboard

Build a simple dashboard or CLI report that shows:

- **Per persona:** Posts this week, comments made, comments received, engagement (reactions/comments from real users)
- **Per post:** Total engagement, real vs. farm comments, link click-throughs (if trackable)
- **System health:** Token expiry dates, failed API calls, rate limit warnings
- **Rotation compliance:** Flag any pattern violations (same persona commenting too often, posts too close together, etc.)

---

## PART 5: CONTENT GENERATION COMMANDS

### 5.1 CLI Commands (suggested interface for MVMT Printer)

```bash
# Generate all content for a new persona
mvmt persona create --name "Sharon Parker" --config persona_1.json

# Generate 5 post variations for a persona
mvmt content posts --persona-id 1 --count 5

# Generate comment bank for a persona
mvmt content comments --persona-id 1

# Generate AI image prompts for a persona
mvmt content images --persona-id 1

# Schedule a post
mvmt deploy post --persona-id 1 --post-id 3 --time "2026-03-01 07:23:00"

# Deploy comment sequence for a post
mvmt deploy comments --post-id 12

# View rotation status
mvmt status rotation

# View upcoming schedule
mvmt status schedule --next 7d

# Refresh Facebook tokens
mvmt auth refresh --all

# Full content generation for all 10 personas
mvmt content generate-all --offer akemi
```

### 5.2 Content Generation Prompts (for AI copy generation)

When the system generates copy for each persona, use this prompt template:

```
You are writing a Facebook post as {persona_name}.

PERSONA DETAILS:
{full persona profile from database}

POST TYPE: {origin_story / update / milestone / gratitude / for_anyone_struggling}

PRODUCT: {offer name — but do NOT mention it in the post}

RULES:
- Write in first person as this persona
- Match their specific voice and vocabulary exactly
- Include at least one detail unique to their backstory
- Do NOT mention any product name
- Do NOT include any URL
- Do NOT include hashtags
- Do NOT use ellipses (...)
- Do NOT use the word "link"
- Keep to {word count range for post type}
- End with something that naturally invites comments
- The post should read like a genuine personal Facebook update,
  not a marketing post
- For male personas: tell the story of their WIFE's transformation
```

---

## PART 6: SCALING TO OTHER OFFERS

This system is designed to be offer-agnostic. To add a new product:

1. Add new affiliate URLs to the `affiliate_urls` table with the new offer tag
2. Adjust persona backstories if needed (some personas may work across multiple offers, some may need new ones)
3. Generate new post/comment content for the new offer
4. The deployment engine, rotation logic, and scheduling remain identical

Consider adding an `offer_id` foreign key to the `posts` and `comments` tables if running multiple offers simultaneously.

---

## PART 7: IMPLEMENTATION PRIORITY

**Phase 1 (Build First):**
1. Database schema + persona storage
2. Content generation for all 10 personas (posts + comments + image prompts)
3. Manual posting workflow (generate content → copy/paste to Facebook)
   - This lets you start running the farm immediately while automation is built

**Phase 2 (Build Second):**
4. Facebook Page API integration (post creation + comment deployment)
5. Scheduling engine with randomization
6. Token management + refresh

**Phase 3 (Build Third):**
7. Cross-pollination rotation matrix
8. Monitoring dashboard
9. Anti-detection measures (IP rotation, engagement pattern diversification)
10. Multi-offer support

---

## APPENDIX A: COMPETITOR INTELLIGENCE

**What the competitor (Lulutox affiliates) is doing right:**
- Posts look 100% organic — no hashtags, no product mentions, no CTAs
- Before/after photos drive engagement even when they're clearly AI-generated
- The author-as-first-commenter with the link is the entire conversion mechanism
- Comment farms create social proof cascade that triggers real engagement
- Multiple personas prevent single-point-of-failure if one account gets flagged
- They're boosting posts (paid) that look organic — Facebook shows "Sponsored" but the content doesn't feel like an ad

**What we can do BETTER:**
- Our personas have deeper, more differentiated backstories (theirs reuse similar stories)
- Our male personas telling wife stories is more authentic than their male personas telling their own weight loss story while promoting a women's tea
- Our comment copy can be more varied (theirs repeats patterns)
- Our cross-pollination can be more systematic (theirs seems ad-hoc)
- We can track what's working per persona and double down on top performers

**Their weak spots to exploit:**
- Their AI-generated photos are getting easier to spot (same face, different backgrounds = obvious)
- Their comment copy is too similar across personas
- They don't have enough variation in post types — it's always the origin story
- Some of their Pages have 6 followers and nothing but weight loss posts — dead giveaway if anyone checks

---

## APPENDIX B: LEGAL/COMPLIANCE NOTES

**Facebook Terms of Service:**
- Coordinated inauthentic behavior is against Facebook's policies. If detected, all connected Pages can be banned simultaneously.
- Mitigation: Ensure Pages look like real people (profile photos, non-product content occasionally, organic engagement patterns)
- The API usage itself is legitimate — it's the coordination that's the risk

**FTC Disclosure:**
- Technically, if personas are fictitious and promoting a product, this could be considered deceptive advertising under FTC guidelines
- The competitor is doing this at scale without apparent enforcement — but that doesn't make it risk-free
- Mitigation: The advertorial (landing page) should carry proper disclaimers. The Facebook posts themselves never mention a product, which creates plausible deniability.

**Recommendation:** Run this with eyes open. The competitor has been running this playbook at scale for months. The risk is real but the precedent exists. Have a plan for if/when Pages get flagged — spin up replacements quickly with the content engine.
