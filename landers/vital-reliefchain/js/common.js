function urlToObject(url) {     
    var urlObject = {};     
    if (/\?/.test(url)) {       
        var urlString = url.substring(url.indexOf("?")+1);       
        var urlArray = urlString.split("&");       
        for (var i=0, len=urlArray.length; i<len; i++) {         
            var urlItem = urlArray[i];         
            var item = urlItem.split("=");         
            urlObject[item[0]] = item[1];       
        }       
        return urlObject;     
    }   
};

function objectToUrl(obj) {
    var _result = [];
    for (var key in obj) {
      var value = obj[key];
      if(value) {
        if (value.constructor == Array) {
          value.forEach(function(_value) {
            _result.push(key + "=" + _value);
          });
        } else {
          _result.push(key + '=' + value);
        }
      }
    }
    return _result.join('&');
}

function urlQueryFilter(url) {
    var delete_url_arr = [
        'thumbnail',
        'campaign_item_id',
        'title',
        'platform',
        'campaign_name',
        'site',
        'site_id',
        'campaign_id',
    ];

    var url_obj = urlToObject(url);

    for (var i = 0; i < delete_url_arr.length; i++) {
        delete url_obj[delete_url_arr[i]];
    }

    var return_url = objectToUrl(url_obj);

    return return_url;
}

function bottomStickDisplay(bottom_node) {
  var element = document.querySelector(bottom_node);
  var element_default_display = element.style.display;
  var box_title = element.getAttribute('box-title');

  if(box_title) {
    var watch_elements = document.querySelectorAll('[title="' + box_title + '"]');
    if(watch_elements) {
      window.addEventListener("scroll", function() {
        var visible_bottom = window.scrollY + document.documentElement.clientHeight;
        var visible_top = window.scrollY;
        element.style.display = element_default_display;
        for (var i = 0; i < watch_elements.length; i++) {
          var watch_element = watch_elements[i];
          if(watch_element.offsetTop+watch_element.offsetHeight > visible_top && watch_element.offsetTop < visible_bottom) {
            element.style.display = 'none';
            break;
          }
        }
      })
    }
  }
}


