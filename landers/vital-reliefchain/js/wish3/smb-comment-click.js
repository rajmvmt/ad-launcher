let faq = document.querySelector('.faq');
if (faq) {
  let previous_data = null;
  let flag = false;
  let smb_questions = faq.querySelectorAll('.faq-question');
  let smb_plus = faq.querySelectorAll('.smb-plus');
  let smb_minus = faq.querySelectorAll('.smb-minus');
  let smb_answers = faq.querySelectorAll('.faq-answer');
  let smb_faq_body = faq.querySelectorAll('.faq-body');

  for (let i = 0; i < smb_faq_body.length; i++) {
    smb_questions[i].addEventListener('click', function (e) {
      let body2ans = smb_faq_body[i].querySelectorAll('.faq-answer');
      for (let j = 0; j < smb_faq_body.length; j++) {
        smb_plus[j].style.display = "block";
        smb_minus[j].style.display = "none"
      }
      for (let j = 0; j < smb_answers.length; j++) {
        smb_answers[j].style.display = "none"
      }

      if ((previous_data == smb_questions[i]) && flag) {
        smb_plus[i].style.display = "block";
        smb_minus[i].style.display = "none";
        for (let j = 0; j < body2ans.length; j++) {
          body2ans[j].style.display = "none"
        }
        flag = false;
      } else {
        smb_plus[i].style.display = "none";
        smb_minus[i].style.display = "block";
        for (let j = 0; j < body2ans.length; j++) {
          body2ans[j].style.display = "block"
        }
        flag = true;
      }
      previous_data = smb_questions[i];
    });
  }
}
