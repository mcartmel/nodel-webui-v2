export function renderComponentError(target: HTMLElement, message: string) {
  const alert = document.createElement('div');
  alert.className = 'nodel-alert nodel-alert-danger nodel-alert-md';
  alert.setAttribute('role', 'alert');
  alert.textContent = message;
  target.replaceChildren(alert);
}
