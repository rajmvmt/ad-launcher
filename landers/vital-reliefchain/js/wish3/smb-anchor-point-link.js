var smb_page = document.querySelector('#smb-page');
var smb_home1 = document.querySelector('#home1');
var smb_home2 = document.querySelector('#home2');

var smb_overview = document.querySelector('#overview');
var smb_overview1 = document.querySelector('#overview1');
var smb_overview2 = document.querySelector('#overview2');

var smb_features = document.querySelector('#features');
var smb_features1 = document.querySelector('#features1');
var smb_features2 = document.querySelector('#features2');

var smb_reviews = document.querySelector('#reviews');
var smb_reviews1 = document.querySelector('#reviews1');
var smb_reviews2 = document.querySelector('#reviews2');

if(smb_home1) {
  smb_home1.addEventListener('click', function(e) {
    smb_page.scrollIntoView({ behavior: "smooth" });
  });
}
if(smb_home2){
  smb_home2.addEventListener('click', function(e) {
    smb_page.scrollIntoView({ behavior: "smooth" });
  });
}
if(smb_overview1) {
  smb_overview1.addEventListener('click', function(e) {
    smb_overview.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest"});
  });
}
if(smb_overview2) {
  smb_overview2.addEventListener('click', function(e) {
    smb_overview.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest"});
  });
}
if(smb_features1) {
  smb_features1.addEventListener('click', function(e) {
    smb_features.scrollIntoView({ behavior: "smooth"});
  });
}
if(smb_features2) {
  smb_features2.addEventListener('click', function(e) {
    smb_features.scrollIntoView({ behavior: "smooth"});
  });
}
if(smb_reviews1) {
  smb_reviews1.addEventListener('click', function(e) {
    smb_reviews.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest"});
  });
}
if(smb_reviews2) {
  smb_reviews2.addEventListener('click', function(e) {
    smb_reviews.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest"});
  });
}