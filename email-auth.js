export function emailAuthMessage(error) {
  if (['invalid_credentials','email_not_confirmed'].includes(error?.code)) return error.code==='email_not_confirmed' ? '这个邮箱尚未完成验证。已有 GitHub 账号可以先用 GitHub 登录。' : '邮箱或密码不正确。已有 GitHub 记录？请先用 GitHub 登录，在账号里设置邮箱密码。';
  if (error?.code==='same_password') return '这个密码和当前密码相同，邮箱登录已可使用。';
  if (error?.code==='weak_password') return '密码不符合要求，请使用更长、更复杂的密码。';
  if (error?.code==='reauthentication_needed' || error?.code==='session_not_found') return '请先重新用 GitHub 登录，再设置邮箱密码。';
  if (error?.status===429 || error?.code==='over_request_rate_limit') return '尝试次数较多，请稍后再试。';
  return '操作暂时未完成，请检查网络后重试。GitHub 登录仍可使用。';
}
export function validateEmailPassword(password, confirmation) {
  if (password.length < 8) return '请设置至少 8 位的密码。';
  if (password !== confirmation) return '两次输入的密码不一致。';
  return '';
}
export function initEmailAuth({ client, onSession, waitForWrites, getCurrentUser }) {
  const $ = id => document.getElementById(id);
  let currentId = null, generation = 0;
  const localPreview = client.isLocalPreview === true;
  const loginForm = $('email-login-form'), passwordForm = $('email-password-form');
  if(localPreview) { $('email-preview-note').hidden=false; $('email-preview-note').textContent='🧪 仅模拟登录，不修改真实账号。演示邮箱：preview@example.test；演示密码：demo-preview。请勿填写真实密码。'; }
  function setUser(user) {
    if(currentId !== (user?.id ?? null)) {
      generation++;currentId=user?.id ?? null;loginForm.reset();passwordForm.reset();
      $('email-login-status').textContent='';$('email-password-status').textContent='';
    }
    $('email-login-toggle').hidden=Boolean(user);
    $('email-login-panel').hidden=Boolean(user);
    $('email-login-toggle').setAttribute('aria-expanded',String(!user));
    if(localPreview)$('email-preview-note').hidden=true;
    $('email-account-panel').hidden=!user;
    $('email-account-value').textContent=user?.email || '当前账号没有可用邮箱，请继续使用 GitHub 登录。';
    $('email-password-save').disabled=!user?.email;
    passwordForm.hidden=!user?.email;
    $('email-method-hint').textContent = user?.email ? '为上方邮箱设置小本本登录密码。设置后，GitHub 和邮箱两种方式都能进入当前账号，原有记录继续保留。' : '请继续使用 GitHub 登录当前账号。';
  }
  $('email-login-toggle').onclick=()=>{const expanded=$('email-login-toggle').getAttribute('aria-expanded')!=='true';$('email-login-panel').hidden=!expanded;$('email-login-toggle').setAttribute('aria-expanded',String(expanded));if(localPreview)$('email-preview-note').hidden=!expanded;if(expanded)$('email-login-address').focus();};
  $('email-account-panel').ontoggle=()=>{if(localPreview)$('email-preview-note').hidden=!$('email-account-panel').open&&$('email-login-panel').hidden;};
  $('email-use-github').onclick=()=>$('login').click();
  $('email-forgot').onclick=()=>$('login').click();
  loginForm.onsubmit=async event=>{
    event.preventDefault();
    const email=$('email-login-address').value.trim();const password=$('email-login-password').value;
    const ownGeneration=generation;
    if(!email||!password)return;
    $('email-login-submit').disabled=true;$('email-login-status').textContent=localPreview?'正在模拟邮箱登录…':'正在登录…';
    try {
      await waitForWrites();
      if(ownGeneration!==generation)return;
      const {data,error}=await client.auth.signInWithPassword({email,password});
      if(error){if(ownGeneration===generation)$('email-login-status').textContent=emailAuthMessage(error);return;}
      if(!data?.session?.user)throw new Error('No session');
      await onSession(data.session);
    }catch{if(ownGeneration===generation)$('email-login-status').textContent='暂时无法登录，请检查网络后重试。';}
    finally{$('email-login-password').value='';$('email-login-submit').disabled=false;}
  };
  passwordForm.onsubmit=async event=>{
    event.preventDefault();
    const user=getCurrentUser();const ownGeneration=generation;
    if(!user?.email)return;
    const password=$('email-new-password').value;
    const issue=validateEmailPassword(password,$('email-confirm-password').value);
    if(issue){$('email-password-status').textContent=issue;return;}
    $('email-password-save').disabled=true;
    $('email-password-status').textContent=localPreview?'正在模拟设置（不修改真实账号）…':'正在为当前账号设置邮箱密码…';
    try {
      const {data:verified,error:verificationError}=await client.auth.getUser();
      if(verificationError||verified?.user?.id!==user.id||ownGeneration!==generation)throw new Error('Account changed');
      const {data,error}=await client.auth.updateUser({password});
      if(ownGeneration!==generation)return;
      if(error){$('email-password-status').textContent=emailAuthMessage(error);return;}
      if(data?.user?.id!==user.id)throw new Error('Account changed');
      passwordForm.reset();
      $('email-password-status').textContent=localPreview?'模拟设置成功。真实账号和密码未改动。':'邮箱密码已设置。以后可用当前邮箱＋密码登录，GitHub 登录也继续保留。';
    }catch{if(ownGeneration===generation)$('email-password-status').textContent='设置尚未完成。请重新登录当前账号后再试。';}
    finally{$('email-new-password').value='';$('email-confirm-password').value='';if(ownGeneration===generation)$('email-password-save').disabled=false;}
  };
  return {setUser};
}
