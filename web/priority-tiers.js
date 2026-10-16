export function equalPriorityTiers(ids) { return { tiers: [[...ids]], excluded: [] }; }
export function tierWeights(model, ids) {
  const seen = new Set();
  const tiers = model.tiers.filter((tier) => tier.length).map((tier) => tier.filter((id) => {
    if (!ids.includes(id) || seen.has(id)) throw new TypeError('Invalid priority membership.');
    seen.add(id); return true;
  }));
  for (const id of model.excluded) {
    if (!ids.includes(id) || seen.has(id)) throw new TypeError('Invalid excluded membership.');
    seen.add(id);
  }
  if (seen.size !== ids.length) throw new TypeError('All categories need a priority membership.');
  return Object.fromEntries(ids.map((id) => [id, model.excluded.includes(id) ? 0
    : tiers.length - tiers.findIndex((tier) => tier.includes(id))]));
}
// Target uses the pre-removal tier index; dropping into the source tier is a no-op.
export function movePriority(model, id, target, kind = 'join') {
  if (!model.tiers.flat().includes(id) && !model.excluded.includes(id)) return model;
  if (kind === 'join' && model.tiers[target]?.includes(id)) return model;
  const raw = model.tiers.map((tier) => tier.filter((item) => item !== id));
  const excluded = model.excluded.filter((item) => item !== id);
  if (kind === 'exclude') excluded.push(id);
  else if (kind === 'join') {
    if (!raw[target]) throw new RangeError('Invalid target tier.');
    raw[target].push(id);
  } else if (kind === 'insert') raw.splice(Math.max(0, Math.min(target, raw.length)), 0, [id]);
  else throw new RangeError('Invalid priority move.');
  return { tiers: raw.filter((tier) => tier.length), excluded };
}
export function mountPriorityTiers(container, { categories, model, onChange, layout = 'vertical', renderIcon = () => '' }) {
  let current = model, dragging = null;
  const horizontal = layout === 'horizontal';
  container.classList.toggle('priority-horizontal',horizontal);
  const ids = categories.map((group) => group.id);
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function commit(next, focusId) { current = next; render(); onChange(next, tierWeights(next, ids));
    if (focusId) container.querySelector('[data-priority-card="' + focusId + '"]')?.focus(); }
  function card(id, tierIndex, excluded = false) {
    const group = categories.find((item) => item.id === id);
    const rank = excluded ? '—' : tierIndex + 1;
    return '<div class="priority-card" draggable="true" tabindex="0" data-priority-card="' + id + '" data-tier="' + tierIndex
      + '" style="--priority-color:'+group.color+'" title="'+escape(group.label)+'：'+(excluded?'不计分':'第'+rank+'档')
      + '" aria-label="' + escape(group.label) + '，' + (excluded ? '不计分' : '第' + (tierIndex + 1) + '档') + '">'
      + (horizontal?'<span class="priority-rank">'+rank+'</span>'+renderIcon(group):'<span class="priority-grip" aria-hidden="true">⠿</span>')
      + '<strong>' + escape(group.label) + '</strong>'
      + (horizontal?'<button class="priority-menu-toggle" type="button" data-priority-menu aria-expanded="false" aria-label="调整'+escape(group.label)+'优先级">⋯</button>':'')
      + '<div class="priority-actions">'
      + (excluded ? '<button type="button" data-move="include" aria-label="' + group.label + '参与计分">计分</button>'
        : '<button type="button" data-move="up" aria-label="提高' + group.label + '优先级">↑</button>'
          + '<button type="button" data-move="down" aria-label="降低' + group.label + '优先级">↓</button>'
          + '<button type="button" data-move="tie" ' + (!tierIndex ? 'disabled' : '') + ' aria-label="' + group.label + '与上一档并列">并列</button>'
          + '<button type="button" data-move="exclude" aria-label="' + group.label + '不计分">不计分</button>') + '</div></div>';
  }
  function render() {
    const weights = tierWeights(current, ids);
    container.innerHTML = current.tiers.map((tier, index) => '<div class="priority-drop-gap" data-insert="' + index
      + '" aria-hidden="true">拖到此处新建一档</div><section class="priority-tier" data-join="' + index
      + '" style="--tier-card-count:' + tier.length + '" aria-label="第' + (index + 1) + '档"><div class="priority-tier-head">第' + (index + 1) + '档 · 权重 '
      + weights[tier[0]] + '<small>同档并列</small></div>' + tier.map((id) => card(id, index)).join('') + '</section>').join('')
      + '<div class="priority-drop-gap" data-insert="' + current.tiers.length + '" aria-hidden="true">拖到此处新建一档</div>'
      + '<section class="priority-excluded" data-exclude="true" style="--tier-card-count:' + current.excluded.length + '"><div class="priority-tier-head">不计分 · 权重 0</div>'
      + current.excluded.map((id) => card(id, -1, true)).join('') + '</section>';
  }
  container.ondragstart = (event) => { const card = event.target.closest('[data-priority-card]'); if (!card) return;
    dragging = card.dataset.priorityCard; event.dataTransfer.setData('text/plain', dragging); event.dataTransfer.effectAllowed = 'move'; };
  container.ondragover = (event) => { const zone=event.target.closest('[data-join],[data-insert],[data-exclude]');
    if (dragging && zone) { event.preventDefault(); container.querySelectorAll('.is-drop-target').forEach((node)=>node.classList.remove('is-drop-target'));zone.classList.add('is-drop-target'); } };
  container.ondrop = (event) => { const zone = event.target.closest('[data-join],[data-insert],[data-exclude]');
    if (!zone || !dragging) return; event.preventDefault();
    const id = dragging; dragging = null;
    commit(movePriority(current, id, Number(zone.dataset.join ?? zone.dataset.insert ?? 0),
      zone.hasAttribute('data-exclude') ? 'exclude' : zone.hasAttribute('data-insert') ? 'insert' : 'join'), id); };
  container.ondragend = () => { dragging = null;container.querySelectorAll('.is-drop-target').forEach((node)=>node.classList.remove('is-drop-target')); };
  function action(card, move) {
    const id = card.dataset.priorityCard, index = Number(card.dataset.tier);
    if (move === 'exclude') commit(movePriority(current, id, 0, 'exclude'), id);
    if (move === 'include') commit(current.tiers.length ? movePriority(current, id, current.tiers.length - 1, 'join')
      : movePriority(current, id, 0, 'insert'), id);
    if (move === 'tie' && index > 0) commit(movePriority(current, id, index - 1, 'join'), id);
    if (move === 'up') commit(movePriority(current, id, Math.max(0, index - (current.tiers[index].length === 1 ? 1 : 0)), 'insert'), id);
    if (move === 'down') commit(movePriority(current, id, Math.min(current.tiers.length,
      index + (current.tiers[index].length > 1 ? 1 : 2)), 'insert'), id);
  }
  container.onclick = (event) => {
    const menu=event.target.closest('[data-priority-menu]');
    if(menu){const card=menu.closest('[data-priority-card]'),open=card.dataset.menuOpen!=='true';
      container.querySelectorAll('[data-menu-open]').forEach((node)=>{delete node.dataset.menuOpen;node.querySelector('[data-priority-menu]')?.setAttribute('aria-expanded','false');});
      card.dataset.menuOpen=String(open);menu.setAttribute('aria-expanded',String(open));return;}
    const button = event.target.closest('[data-move]');
    if (button && !button.disabled) action(button.closest('[data-priority-card]'), button.dataset.move); };
  container.onkeydown = (event) => { if (!event.target.matches('[data-priority-card]')) return;
    const moves = {ArrowUp:'up',ArrowDown:'down',ArrowLeft:'tie',Delete:'exclude'};
    if (moves[event.key]) { event.preventDefault(); action(event.target, moves[event.key]); } };
  render();
}
