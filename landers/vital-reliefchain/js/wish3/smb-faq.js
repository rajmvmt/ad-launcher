let faq_component = document.querySelector('.faq-component');

if (faq_component) {
  let openIndex = null;
  let smb_faq_text_content = faq_component.querySelectorAll('.faq-text-content');
  let smb_question_part = faq_component.querySelectorAll('.faq-question-part');
  let smb_plus_icon = faq_component.querySelectorAll('.smb-plus-icon');
  let smb_minus_icon = faq_component.querySelectorAll('.smb-minus-icon');
  let smb_faq_answer_part = faq_component.querySelectorAll('.faq-answer-part');


  function animateHeight(element, targetHeight, duration) {
    const startHeight = element.clientHeight;
    const startTime = performance.now();

    function step(timestamp) {
      const progress = Math.min(1, (timestamp - startTime) / duration);
      const currentHeight = startHeight + (targetHeight - startHeight) * progress;
      element.style.maxHeight = currentHeight + 'px';

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    element.style.overflow = "hidden";
    requestAnimationFrame(step);
  }

  for (let i = 0; i < smb_faq_text_content.length; i++) {
    smb_question_part[i].addEventListener('click', function (e) {
      if (openIndex !== null) {
        animateHeight(smb_faq_answer_part[openIndex], 0, 300);
        smb_plus_icon[openIndex].style.display = 'block';
        smb_minus_icon[openIndex].style.display = 'none';
      }

      if (openIndex === i) {
        openIndex = null;
      } else {
        openIndex = i;
        animateHeight(smb_faq_answer_part[i], smb_faq_answer_part[i].scrollHeight, 300);
        smb_plus_icon[i].style.display = 'none';
        smb_minus_icon[i].style.display = 'block';
      }
    });
  }
}
