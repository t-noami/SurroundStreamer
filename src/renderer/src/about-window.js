async function initializeAboutWindow() {
  const info = await window.api.getAppInfo()
  document.getElementById('about-version').textContent = `Version ${info.version}`
  document.getElementById('about-studio').textContent = info.studio
  document.getElementById('about-contact').textContent = info.contact
  document.getElementById('about-github').textContent = info.github
  document.getElementById('about-copyright').textContent = info.copyright
}

initializeAboutWindow().catch(() => {})
