var smb_fixed_flag = document.querySelector('#smb-fixed-flag');
var smb_fixed = document.querySelector('.smb-header-fixed');
var smb_none = document.querySelector('#smb-flag-none');
var smb_bottom = document.querySelector('.smb-button-bottom');
if(!document.querySelector('.smb-header .smb-header-main')) {
  smb_fixed.style.position = 'fixed';
  smb_fixed_flag.style.marginTop = smb_fixed.getBoundingClientRect().height + 'px';
}

window.addEventListener('scroll', function(e) {
  var scroll = smb_fixed_flag.getBoundingClientRect().top;
  var scroll_none = smb_none.getBoundingClientRect().top;

  if(scroll < 0){
    smb_fixed.classList.add('smb-fixed')
  }else if(scroll > 0){
    smb_fixed.classList.remove('smb-fixed')
  }

  if(scroll_none > 1500){
    smb_bottom.classList.add('smb-mb-block')
  }else if(scroll_none < 1000){
    smb_bottom.classList.remove('smb-mb-block')
  }
});
