const defaultActiveClass = 'nodel-menu-item-active';

function isHidden(element: HTMLElement) {
  return element.hidden || element.classList.contains('hidden') || Boolean(element.closest('[hidden], .hidden'));
}

export function getPopoverOptions(container: ParentNode | null, optionSelector: string) {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(optionSelector)).filter((option) => !isHidden(option));
}

export function clearActivePopoverOption(container: ParentNode | null, optionSelector: string, activeClass = defaultActiveClass) {
  for (const option of getPopoverOptions(container, optionSelector)) {
    option.classList.remove(activeClass);
  }
}

export function moveActivePopoverOption(container: ParentNode | null, optionSelector: string, direction: 1 | -1, activeClass = defaultActiveClass) {
  const options = getPopoverOptions(container, optionSelector);
  if (options.length === 0) {
    return null;
  }

  const currentIndex = options.findIndex((option) => option.classList.contains(activeClass));
  const nextIndex = currentIndex === -1
    ? direction === 1 ? 0 : options.length - 1
    : (currentIndex + direction + options.length) % options.length;

  for (const option of options) {
    option.classList.remove(activeClass);
  }

  const active = options[nextIndex];
  active.classList.add(activeClass);
  active.scrollIntoView?.({ block: 'nearest' });
  return active;
}

export function activateActivePopoverOption(container: ParentNode | null, optionSelector: string, activeClass = defaultActiveClass) {
  const active = getPopoverOptions(container, optionSelector).find((option) => option.classList.contains(activeClass));
  if (!active) {
    return false;
  }

  active.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
