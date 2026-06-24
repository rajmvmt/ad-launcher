setCenterProduct();
window.addEventListener('resize', function () {
    setCenterProduct();
})

function setCenterProduct() {
    var product_sell_point = document.getElementById("product-sell-point");
    if(product_sell_point) {
        var center_product_module = product_sell_point.querySelector(".center-product-module");
        var product_box = product_sell_point.querySelector(".product-box");
        var product_images = product_sell_point.querySelectorAll(".product-image");
        var product_contents = product_sell_point.querySelectorAll(".product-content");
        var product_backgrounds = product_sell_point.querySelectorAll(".product-background");
        var product_texts = product_sell_point.querySelectorAll(".product-text");
    }
    var product_text_border_box_height_arr = [];

    if (product_texts) {
        var product_boxs_height = product_images[0].clientHeight;

        product_texts.forEach((function (product_item) {
            product_text_border_box_height_arr.push(product_item.clientHeight);
        }))
    }

    var product_text_border_box_max_height = Math.max(...product_text_border_box_height_arr);
    
    if (product_contents) {
        product_contents.forEach((function (product_item) {
            product_item.setAttribute("style", `height:${product_text_border_box_max_height}px`);
        }))
    }

    if (product_backgrounds) {
        product_backgrounds.forEach((function (product_item) {
            product_item.setAttribute("style", `height:${product_text_border_box_max_height}px`);
        }))
    }

    if (window.innerWidth && window.innerWidth > 1200) {
        if (product_box) {
            product_box.setAttribute("style", `bottom:-${product_text_border_box_max_height}px`);
        }

        if (center_product_module) {
            center_product_module.setAttribute("style", `height:${product_boxs_height - product_text_border_box_max_height}px`)
        }

    } else {
        if (product_box) {
            product_box.removeAttribute("style");
        }

        if (center_product_module) {
            center_product_module.removeAttribute("style");
        }
    }
}