var smb_carousel = document.querySelector(".smb-container9-carousel");
var smb_prev = document.getElementById("prev-btn");
var smb_next = document.getElementById("next-btn");

// 定义全局变量
var currentIndex = 0; // 当前显示的图片索引
if(smb_prev) {
  smb_prev.addEventListener("click", prevFun);
}

if(smb_prev) {
  smb_next.addEventListener("click", nextFun);
}

function prevFun() {
  smb_carousel.style.transition = "0.5s";
  if (currentIndex === 0) {
    smb_carousel.style.transition = "0.5s"; // 为了实现无缝滚动，清除动画
    currentIndex = 1;
  } else {
    --currentIndex;
  }
  smb_carousel.style.left = `-${currentIndex * 400}px`;
}

function nextFun() {
  smb_carousel.style.transition = "0.5s";
  if (currentIndex === 1) {
    smb_carousel.style.transition = "0.5s"; // 为了实现无缝滚动，清除动画
    currentIndex = 0; // 重新播放第一张
  } else {
    ++currentIndex;
  }
  smb_carousel.style.left = `-${currentIndex * 400}px`;
}