function lockWidth(el,on){ if(!el) return; if(on){ if(!el.dataset.w) el.dataset.w = el.offsetWidth+'px'; el.style.width = el.dataset.w; } else { el.style.width=''; delete el.dataset.w; } }

export function setSending(ui,on,{sendBtn,inputEl}={}){
  ui.sending = !!on;
  try{
    if (sendBtn) sendBtn.disabled = !!on;
    if (inputEl) inputEl.disabled = !!on;
    if (on){
      if (sendBtn){ lockWidth(sendBtn,true); sendBtn.classList.add('loading'); if(!sendBtn.dataset.prev) sendBtn.dataset.prev = sendBtn.textContent||'Enviar'; sendBtn.textContent = sendBtn.dataset.prev; }
    } else {
      if (sendBtn){ sendBtn.classList.remove('loading'); lockWidth(sendBtn,false); sendBtn.textContent = sendBtn.dataset.prev||'Enviar'; }
      if (inputEl) inputEl.disabled = false;
    }
  }catch{}
}

export function setAuthLoading(ui,on,kind=null,{authUserEl,authPinEl,authLoginBtn,authRegisterBtn}={}){
  ui.authLoading = !!on; ui.authKind = on ? kind : null;
  const targetBtn = (kind==='login')?authLoginBtn:(kind==='register')?authRegisterBtn:null;
  try{
    [authUserEl,authPinEl,authLoginBtn,authRegisterBtn].forEach(el=>{ if(el) el.disabled=!!on; });
    if (on && targetBtn){
      lockWidth(targetBtn,true); targetBtn.classList.add('loading');
      if(!targetBtn.dataset.prev) targetBtn.dataset.prev = targetBtn.textContent || (kind==='login'?'Entrar':'Crear');
      targetBtn.textContent = targetBtn.dataset.prev;
    } else {
      [authLoginBtn, authRegisterBtn].forEach(b=>{ if(!b) return; b.classList.remove('loading'); lockWidth(b,false); if(b.dataset.prev) b.textContent = b.dataset.prev; });
    }
  }catch{}
}

export function setConfirmLoading(ui,on,yesBtn,noBtn){
  ui.confirmLoading = !!on;
  try{
    if (yesBtn) yesBtn.disabled = !!on;
    if (noBtn)  noBtn.disabled  = !!on;
    const set = (btn, txt) => { if(!btn) return; lockWidth(btn,on); btn.classList.toggle('loading',on); btn.textContent = txt; };
    set(yesBtn,'Sí'); set(noBtn,'No');
  }catch{}
}
