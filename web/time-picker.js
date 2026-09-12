/* Two independent, touch-scrollable wheels; times stay in the existing HH:MM format. */
(() => {
  'use strict';
  const pad = value => String(value).padStart(2, '0');
  function mount(root, options) {
    const values = options.value.split(':').map(Number);
    const wheels = [], cleanups = [];
    let disabled = Boolean(options.disabled), destroyed = false;
    root.innerHTML = [
      ['hour', '小时', '时', 24],
      ['minute', '分钟', '分', 60],
    ].map(([key, label, unit, count], index) => `${index ? '<span class="time-picker-separator" aria-hidden="true">:</span>' : ''}<div class="time-wheel-column"><span class="time-wheel-label" id="time-${key}-label">${label}</span><div class="time-wheel-track"><div class="time-wheel" data-time-wheel="${key}" role="spinbutton" tabindex="0" aria-labelledby="time-${key}-label" aria-describedby="time-picker-help" aria-valuemin="0" aria-valuemax="${count - 1}" aria-valuenow="${values[index]}" aria-valuetext="${pad(values[index])} ${unit}">${Array.from({length:count}, (_, value) => `<div class="time-wheel-number" data-time-number="${value}" aria-hidden="true">${pad(value)}</div>`).join('')}</div></div></div>`).join('');

    const currentTime = () => values.map(pad).join(':');
    function publish() { if (!destroyed) options.onChange(currentTime()); }
    root.querySelectorAll('.time-wheel').forEach((element, index) => {
      const items = [...element.children], unit = index ? '分' : '时';
      let height = items[0].getBoundingClientRect().height;
      const clamp = value => Math.max(0, Math.min(items.length - 1, value));
      let selected = values[index], timer, holding = false, moved = false, startY = 0;
      function paint(value) {
        value = clamp(value);
        items[selected].classList.remove('is-selected');
        selected = value; values[index] = value;
        items[selected].classList.add('is-selected');
        element.setAttribute('aria-valuenow', String(value));
        element.setAttribute('aria-valuetext', `${pad(value)} ${unit}`);
        publish();
      }
      function stop() {
        clearTimeout(timer);
        paint(Math.round(element.scrollTop / height));
        // Stop momentum before saving so the saved time matches the highlighted row.
        element.scrollTo({top:selected * height, behavior:'auto'});
      }
      function settle() {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (destroyed || holding) return;
          const value = disabled ? selected : clamp(Math.round(element.scrollTop / height));
          paint(value);
          // Also provides snapping on WebViews without CSS scroll-snap support.
          if (Math.abs(element.scrollTop - value * height) > 0.5) {
            element.scrollTo({top:value * height, behavior:'smooth'});
          }
        }, 150);
      }
      function onScroll() {
        if (destroyed) return;
        if (disabled) { element.scrollTop = selected * height; return; }
        paint(Math.round(element.scrollTop / height));
        settle();
      }
      function choose(value) {
        clearTimeout(timer);
        // Taps and keyboard changes are exact; swipes retain native scroll momentum.
        paint(clamp(value));
        element.scrollTo({top:selected * height, behavior:'auto'});
      }
      function onClick(event) {
        if (disabled || moved) return;
        const item = event.target.closest('[data-time-number]');
        if (item) { choose(Number(item.dataset.timeNumber)); element.focus({preventScroll:true}); }
      }
      function onKey(event) {
        if (disabled) return;
        const changes = {ArrowUp:1, ArrowDown:-1, PageUp:5, PageDown:-5};
        if (!(event.key in changes) && !['Home','End'].includes(event.key)) return;
        event.preventDefault();
        choose(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : selected + changes[event.key]);
      }
      function onStart(event) {
        holding = true; moved = false; clearTimeout(timer);
        startY = event.touches ? event.touches[0].clientY : event.clientY;
      }
      function onMove(event) {
        const y = event.touches ? event.touches[0].clientY : event.clientY;
        if (holding && Math.abs(y - startY) > 6) moved = true;
      }
      function onEnd() { holding = false; settle(); }
      function listen(type, handler) {
        element.addEventListener(type, handler, {passive:type !== 'keydown'});
        cleanups.push(() => element.removeEventListener(type, handler));
      }
      listen('scroll', onScroll); listen('click', onClick); listen('keydown', onKey);
      listen('touchstart', onStart); listen('touchmove', onMove);
      listen('touchend', onEnd); listen('touchcancel', onEnd);
      listen('mousedown', onStart); listen('mouseup', onEnd);
      function resize() { height=items[0].getBoundingClientRect().height; element.scrollTop=selected*height; }
      window.addEventListener('medtime-layout-changed',resize);
      cleanups.push(()=>window.removeEventListener('medtime-layout-changed',resize));
      paint(selected);
      element.scrollTop = selected * height;
      wheels.push({element, stop, cancel:() => clearTimeout(timer)});
    });
    function setDisabled(next) {
      wheels.forEach(wheel => wheel.stop());
      disabled = Boolean(next);
      root.classList.toggle('is-disabled', disabled);
      wheels.forEach(({element}) => {
        element.setAttribute('aria-disabled', String(disabled));
        element.tabIndex = disabled ? -1 : 0;
      });
    }
    setDisabled(disabled);
    return {
      setDisabled,
      value() { wheels.forEach(wheel => wheel.stop()); return currentTime(); },
      destroy() { destroyed = true; wheels.forEach(wheel => wheel.cancel()); cleanups.forEach(cleanup => cleanup()); },
    };
  }
  window.MedTimePicker = Object.freeze({mount});
})();
