window.addEventListener('load', function () {
    if (window.innerWidth && window.innerWidth > 1200) {
        setMainBoxHeight();
    }
    window.addEventListener('resize', function () {
        removeMainBoxHeight();
        if (window.innerWidth && window.innerWidth > 1200) {
            setMainBoxHeight();
        }
    })
})
var main_boxs = document.querySelectorAll(".main-box");

function setMainBoxHeight() {
    if (main_boxs.length >= 4) {
        for (var i = 0; i < main_boxs.length; i++) {
            var first_box = main_boxs[i];
            var second_box = main_boxs[i + 3];
            if (!second_box) break;
            var first_box_height = first_box.clientHeight;
            var second_box_height = second_box.clientHeight;

            if (first_box_height > second_box_height) {
                second_box.setAttribute("style", `height:${first_box_height}px`);
            } else {
                first_box.setAttribute("style", `height:${second_box_height}px`);
            }
        }
    }
}

function removeMainBoxHeight() {
    if (main_boxs) {
        main_boxs.forEach((function (content_item) {
            content_item.removeAttribute("style");
        }))
    }
}