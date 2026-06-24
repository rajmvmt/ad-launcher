window.rem_fz = 30;

setRemFz();
window.addEventListener('resize', function() {
    setRemFz();
})

function setRemFz() {
    if(window.innerWidth && window.innerWidth <= 1200) {
        document.documentElement.style.fontSize = (window.innerWidth / 750 * window.rem_fz) + 'px';
    } else {
        document.documentElement.removeAttribute('style');
    }
}