(() => {
  const STORAGE_KEY = 'micro-kanban-v1';

  // DOM
  const boardEl = document.getElementById('board');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');
  const progressPct = document.getElementById('progressPct');

  const fab = document.getElementById('fab');
  const modal = document.getElementById('modal');
  const sheetTitle = document.getElementById('sheetTitle');
  const taskTitle = document.getElementById('taskTitle');
  const taskDue = document.getElementById('taskDue');
  const taskTime = document.getElementById('taskTime');       // optional time
  const taskColumnSel = document.getElementById('taskColumn'); // Category
  const taskTags = document.getElementById('taskTags');
  const taskNotes = document.getElementById('taskNotes');
  const taskColor = document.getElementById('taskColor');     // optional color
  const saveAddBtn = document.getElementById('saveAdd');
  const cancelAddBtn = document.getElementById('cancelAdd');
  const deleteCardBtn = document.getElementById('deleteCardBtn');

  const addColumnBtn = document.getElementById('addColumnBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importInput = document.getElementById('importInput');
  const clearBtn = document.getElementById('clearBtn');

  const confirmModal = document.getElementById('confirmModal');
  const confirmCancel = document.getElementById('confirmCancel');
  const confirmDelete = document.getElementById('confirmDelete');

  // Help modal (first-load guide)
  const helpModal = document.getElementById('helpModal');
  const HELP_KEY = 'micro-kanban-help-shown-v1';

  // State
  let state = loadState() || createInitialState();
  let drag = null;                 // card drag session
  let editContext = null;          // {mode: 'add'|'edit', cardId?:string}
  let isDraggingNow = false;
  let pendingDeleteId = null;

  // Column drag state
  let cDrag = null;

  // Auto-scroll during drag
  let rafId = null;
  let lastPointer = {x: 0, y: 0};
  const SCROLL_ZONE = 60;
  const MAX_SPEED = 28;

  // ===== Utils
  function uid(prefix='id'){ return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}` }
  function debounce(fn, wait){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait);} }
  function todayISO(){ const d=new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }
  function tint(hex, alpha){
    if(!/^#([0-9a-f]{6})$/i.test(hex)) return '#fff';
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ===== Initial State with "Floating"
  function createInitialState(){
    const todo = {id: uid('col'), title:'To-Do'};
    const doing = {id: uid('col'), title:'Doing'};
    const done  = {id: uid('col'), title:'Done'};
    const floating = {id: uid('col'), title:'Floating'}; // NEW default category
    const c1 = {id: uid('card'), title:'Set up project', notes:'Create initial board and categories', due:null, dueTime:null, color:'#ffffff', tags:['setup'], columnId: todo.id, createdAt: Date.now()};
    const c2 = {id: uid('card'), title:'Draft first tasks', notes:'Outline must-haves', due:null, dueTime:null, color:'#ffffff', tags:['planning'], columnId: doing.id, createdAt: Date.now()};
    const c3 = {id: uid('card'), title:'Celebrate small wins', notes:'Move a card to Done', due:null, dueTime:null, color:'#ffffff', tags:['motivation'], columnId: done.id, createdAt: Date.now()};
    return {
      columns: [todo, doing, done, floating], // include Floating
      lists: {
        [todo.id]: [c1.id],
        [doing.id]: [c2.id],
        [done.id]: [c3.id],
        [floating.id]: []
      },
      cards: {[c1.id]: c1, [c2.id]: c2, [c3.id]: c3}
    };
  }
  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ console.warn('Failed to load board', e); return null; }
  }
  const saveState = debounce(() => {
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch(e){ console.warn('Failed to save board', e); }
    refreshProgress();
    refreshColumnSelector();
  }, 80);

  // ===== Rendering
  function el(tag, attrs={}, text){
    const node = document.createElement(tag);
    for(const k in attrs){
      if(attrs[k] == null) continue;
      if(k === 'class') node.className = attrs[k];
      else if(k === 'style') node.style.cssText = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    if(text !== undefined) node.textContent = text;
    return node;
  }
  function btn(label, onClick){ const b = el('button', {class:'btn'}, label); b.addEventListener('click', onClick); return b; }

  function renderBoard(){
    boardEl.innerHTML = '';
    state.columns.forEach(col => {
      if(!state.lists[col.id]) state.lists[col.id] = [];
      const colEl = el('div', {class:'column', 'data-col':col.id});

      // Add special classes based on column title
    const titleLower = col.title.toLowerCase();
    if(titleLower.includes('floating')) colEl.classList.add('col-floating');
    if(titleLower.includes('done')) colEl.classList.add('col-done');
      
      // Header (allow drag by header background; not on title/buttons)
      const head = el('div', {class:'col-head'});
      head.addEventListener('pointerdown', (e) => {
        const isOnTools = e.target.closest('.col-tools');
        const isOnTitle = e.target.closest('.col-title');
        if(isOnTools || isOnTitle) return;          // don't steal clicks for buttons/title edit
        startColumnDrag(e, colEl, col.id);
      });

      const grip = el('span', {class:'col-grip', title:'Drag to reorder'});
      grip.addEventListener('pointerdown', (e)=>startColumnDrag(e, colEl, col.id));

      const title = el('div', {class:'col-title', contenteditable:'true', spellcheck:'false'}, col.title);
      // Enter commits (no newline)
      title.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); title.blur(); }});
      title.addEventListener('blur', () => {
        const newTitle = title.textContent.trim() || 'Untitled';
        col.title = newTitle; saveState(); refreshProgress(); refreshColumnSelector();
      });

      const headTools = el('div', {class:'col-tools'});
      const addBtn = btn('+ Task', () => openSheet('add', null, col.id));
      const delBtn = btn('Delete', () => removeColumn(col.id));
      headTools.append(addBtn, delBtn);
      head.append(grip, title, headTools);

      const cardsWrap = el('div', {class:'cards', 'data-cards':col.id});
      if(state.lists[col.id].length === 0){
        cardsWrap.append(el('div', {class:'drop-hint'}, 'Drop cards here'));
      } else {
        state.lists[col.id].forEach(cardId => {
          const card = state.cards[cardId];
          if(card) cardsWrap.append(renderCard(card));
        });
      }

      colEl.append(head, cardsWrap);
      boardEl.append(colEl);
    });

    attachCardDragHandlers();
    refreshProgress();
    refreshColumnSelector();
  }

  function renderCard(card){
    const c = el('div', {class:'card', 'data-card': card.id});
    if(card.color && card.color !== '#ffffff'){
      c.style.borderLeft = `6px solid ${card.color}`;
      c.style.background = tint(card.color, 0.12);
    }
    const h4 = el('h4', {}, card.title || 'Untitled');
    const meta = el('div', {class:'meta'});
    if(card.due){
      const overdue = isOverdue(card.due, card.dueTime) ? ' overdue' : '';
      meta.append(el('span', {class:'due'+overdue}, fmtDateTime(card.due, card.dueTime)));
    }
    if(card.tags && card.tags.length){
      card.tags.forEach(t => meta.append(el('span', {class:'tag'}, t)));
    }
    c.append(h4, meta);

    // Click/tap to edit
    c.addEventListener('click', () => {
      if(isDraggingNow) return;
      openSheet('edit', card.id, card.columnId);
    });
    return c;
  }

  // ===== Progress (exclude Floating)
  function refreshProgress(){
    const floatingCol = state.columns.find(c => /(^|\W)floating(\W|$)/i.test(c.title));
    const floatingIds = floatingCol ? (state.lists[floatingCol.id] || []) : [];

    const allCardIds = Object.keys(state.cards);
    const validCardIds = allCardIds.filter(id => !floatingIds.includes(id));
    const total = validCardIds.length;

    const doneCol = state.columns.find(c => /(^|\W)done(\W|$)/i.test(c.title)) || null;
    const completed = doneCol
      ? (state.lists[doneCol.id]?.filter(id => validCardIds.includes(id)).length || 0)
      : 0;

    const pct = total ? Math.round((completed/total)*100) : 0;
    progressText.textContent = `${completed} of ${total} done`;
    progressBar.style.width = `${pct}%`;
    progressPct.textContent = `${pct}%`;
  }

  function refreshColumnSelector(){
    const cur = taskColumnSel.value;
    taskColumnSel.innerHTML = '';
    state.columns.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.title;
      taskColumnSel.append(opt);
    });
    if(cur) taskColumnSel.value = cur;
  }

  // ===== Sheet (Add/Edit)
  function openSheet(mode='add', cardId=null, prefColId=null){
    editContext = {mode, cardId};
    sheetTitle.textContent = (mode === 'edit') ? 'Edit Task' : 'New Task';
    deleteCardBtn.style.display = (mode === 'edit') ? '' : 'none';

    taskDue.min = todayISO(); // block past dates

    if(mode === 'edit' && cardId){
      const card = state.cards[cardId];
      taskTitle.value = card.title || '';
      taskDue.value = card.due || '';
      taskTime.value = card.dueTime || '';
      taskTags.value = (card.tags || []).join(', ');
      taskNotes.value = card.notes || '';
      taskColor.value = card.color || '#ffffff';
      refreshColumnSelector();
      taskColumnSel.value = card.columnId;
    }else{
      taskTitle.value = '';
      taskDue.value = '';
      taskTime.value = '';
      taskTags.value = '';
      taskNotes.value = '';
      taskColor.value = '#ffffff';
      refreshColumnSelector();
      taskColumnSel.value = prefColId || (state.columns[0]?.id || '');
    }

    modal.classList.add('open');
    setTimeout(()=>taskTitle.focus(), 0);
  }
  function closeSheet(){ modal.classList.remove('open'); editContext = null; }

  function saveFromSheet(){
    const title = taskTitle.value.trim();
    if(!title){ taskTitle.focus(); return; }
    const columnId = taskColumnSel.value || state.columns[0]?.id;
    const due = taskDue.value ? taskDue.value : null;
    const dueTime = taskTime.value ? taskTime.value : null;
    const tags = taskTags.value.split(',').map(s => s.trim()).filter(Boolean);
    const notes = taskNotes.value.trim() || '';
    const color = taskColor.value || '#ffffff';

    if(due && due < todayISO()){ alert('Please choose today or a future date.'); return; }

    if(editContext?.mode === 'edit' && editContext.cardId){
      const c = state.cards[editContext.cardId];
      c.title = title; c.due = due; c.dueTime = dueTime; c.tags = tags; c.notes = notes; c.color = color;
      if(c.columnId !== columnId){
        moveCard(c.id, columnId, null, {render:false});
      }
      saveState(); renderBoard(); closeSheet();
    }else{
      const card = {id: uid('card'), title, notes, due, dueTime, color, tags, columnId, createdAt: Date.now()};
      state.cards[card.id] = card;
      state.lists[columnId] = state.lists[columnId] || [];
      state.lists[columnId].push(card.id);
      saveState(); renderBoard(); closeSheet();
    }
  }

  deleteCardBtn.addEventListener('click', () => {
    if(!(editContext && editContext.cardId)) return;
    pendingDeleteId = editContext.cardId;
    openConfirm();
  });

  // ===== Export / Import / Clear
  function exportBoard(){
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], {type:'application/json'});
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0,10);
    a.href = URL.createObjectURL(blob);
    a.download = `micro-kanban-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function importBoard(file){
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const obj = JSON.parse(reader.result);
        if(!obj.columns || !obj.lists || !obj.cards) throw new Error('Invalid board file');
        state = obj; saveState(); renderBoard();
      }catch(e){ alert('Import failed: '+e.message); }
    };
    reader.readAsText(file);
  }
  function clearAll(){
    if(!confirm('This will erase the board on this device. Continue?')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = createInitialState();
    saveState(); renderBoard();
  }

  // ===== Confirm modal (delete)
  const openConfirm = ()=> confirmModal.classList.add('open');
  const closeConfirm = ()=> { confirmModal.classList.remove('open'); pendingDeleteId = null; };
  confirmCancel.addEventListener('click', closeConfirm);
  confirmDelete.addEventListener('click', () => {
    if(pendingDeleteId){
      trulyDeleteCard(pendingDeleteId);
      pendingDeleteId = null;
    }
    closeConfirm();
  });

  function trulyDeleteCard(cardId){
    for(const colId in state.lists){
      const idx = state.lists[colId].indexOf(cardId);
      if(idx !== -1) state.lists[colId].splice(idx,1);
    }
    delete state.cards[cardId];
    saveState(); renderBoard();
  }

  // ===== Column ops
  function addColumn(title='New Category'){
    const col = {id: uid('col'), title};
    state.columns.push(col);
    state.lists[col.id] = [];
    saveState(); renderBoard();
  }
  function removeColumn(colId){
    const col = state.columns.find(c => c.id === colId);
    if(col && /(^|\W)floating(\W|$)/i.test(col.title)){
      // Optional guard—comment out to allow deletion of Floating
      // alert('Floating category cannot be deleted.');
      // return;
    }
    if(!confirm('Delete this category and its cards?')) return;
    const ids = state.lists[colId] || [];
    ids.forEach(id => delete state.cards[id]);
    delete state.lists[colId];
    state.columns = state.columns.filter(c => c.id !== colId);
    saveState(); renderBoard();
  }

  // ===== Card move
  function moveCard(cardId, targetColId, beforeCardId=null, opts={render:true}){
    const card = state.cards[cardId]; if(!card) return;
    for(const colId in state.lists){
      const idx = state.lists[colId].indexOf(cardId);
      if(idx !== -1){ state.lists[colId].splice(idx,1); break; }
    }
    const list = state.lists[targetColId] || (state.lists[targetColId]=[]);
    if(beforeCardId){
      const i = list.indexOf(beforeCardId);
      if(i === -1) list.push(cardId); else list.splice(i,0,cardId);
    }else{
      list.push(cardId);
    }
    card.columnId = targetColId;
    saveState();
    if(opts.render) renderBoard();
  }

  // ===== Formatting
  function fmtDateTime(isoDate, hhmm){
    const [y,m,d] = isoDate.split('-').map(Number);
    const opts = {month:'short', day:'numeric'};
    let s = new Date(y, m-1, d).toLocaleDateString(undefined, opts);
    if(hhmm){
      const [hh, mm] = hhmm.split(':').map(Number);
      const t = new Date(); t.setHours(hh, mm ?? 0, 0, 0);
      s += ' ' + t.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
    }
    return s;
  }
  function isOverdue(isoDate, hhmm){
    if(!isoDate) return false;
    const now = new Date();
    const [y,m,d] = isoDate.split('-').map(Number);
    const due = new Date(y, m-1, d);
    if(!hhmm){ due.setHours(23,59,59,999); } else {
      const [hh, mm] = hhmm.split(':').map(Number);
      due.setHours(hh, mm ?? 0, 0, 0);
    }
    return due < now;
  }

  /* ===========================
   * Card Drag & Drop + Edge Auto-Scroll
   * =========================== */
  function attachCardDragHandlers(){
    const cards = boardEl.querySelectorAll('.card');
    cards.forEach(card => card.addEventListener('pointerdown', onPointerDownCard));
  }

  // FIXED: attach pointermove immediately; mouse starts on small move; touch starts on long-press
  function onPointerDownCard(initialEv){
    const cardEl = initialEv.currentTarget;
    const pointerType = initialEv.pointerType || 'mouse';
    let pressed = true;
    let started = false;
    const startX = initialEv.clientX, startY = initialEv.clientY;

    let timer = null;
    if (pointerType !== 'mouse') {
      timer = setTimeout(() => { if (pressed) startDragNow(initialEv); }, 220);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once:true });
    window.addEventListener('pointercancel', onUp, { once:true });

    function startDragNow(e){
      if (started) return;
      started = true;
      isDraggingNow = true;
      beginCardDrag(cardEl, e || initialEv);
    }

    function onMove(e){
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;

      if (!started) {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (pointerType === 'mouse' && Math.hypot(dx, dy) > 6) {
          startDragNow(e);
        }
        return;
      }
      if (drag) moveCardDrag(e.clientX, e.clientY);
    }

    function onUp(e){
      pressed = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      stopAutoScroll();
      if (drag) endCardDrag(e.clientX, e.clientY);
      setTimeout(()=>{ isDraggingNow = false; }, 0);
    }
  }

  function beginCardDrag(cardEl, ev){
    const rect = cardEl.getBoundingClientRect();
    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('dragging');
    ghost.style.setProperty('--drag-w', rect.width+'px');
    document.body.appendChild(ghost);

    const ph = document.createElement('div');
    ph.className = 'placeholder';
    ph.style.setProperty('--ph-h', rect.height+'px');
    cardEl.parentElement.insertBefore(ph, cardEl);
    cardEl.style.visibility='hidden';

    drag = {
      cardId: cardEl.getAttribute('data-card'),
      offsetX: ev.clientX - rect.left,
      offsetY: ev.clientY - rect.top,
      ghost, ph, srcListEl: cardEl.parentElement, srcColId: cardEl.closest('.column')?.getAttribute('data-col') || null
    };
    lastPointer.x = ev.clientX; lastPointer.y = ev.clientY;
    moveCardDrag(ev.clientX, ev.clientY);
    startAutoScroll();
  }

  function moveCardDrag(clientX, clientY){
    if(!drag) return;
    const g = drag.ghost;
    g.style.left = (clientX - drag.offsetX) + 'px';
    g.style.top  = (clientY - drag.offsetY) + 'px';

    const elem = document.elementFromPoint(clientX, clientY);
    const column = elem ? elem.closest('.column') : null;
    document.querySelectorAll('.column').forEach(c => c.classList.remove('focus'));
    if(column){
      column.classList.add('focus');
      const list = column.querySelector('.cards');
      positionCardPlaceholder(list, clientY);
    }else{
      if(drag.ph.parentElement !== drag.srcListEl){
        drag.ph.remove();
        drag.srcListEl.appendChild(drag.ph);
      }
    }
  }

  function positionCardPlaceholder(listEl, y){
    if(!drag || !listEl) return;
    if(drag.ph.parentElement !== listEl){
      drag.ph.remove();
      listEl.appendChild(drag.ph);
    }
    const cards = [...listEl.querySelectorAll('.card')].filter(c => c.style.visibility !== 'hidden');
    let before = null;
    for(const c of cards){
      const r = c.getBoundingClientRect();
      if(y < r.top + r.height/2){ before = c; break; }
    }
    if(before) listEl.insertBefore(drag.ph, before);
    else listEl.appendChild(drag.ph);
  }

  function endCardDrag(clientX, clientY){
    const elem = document.elementFromPoint(clientX, clientY);
    const column = elem ? elem.closest('.column') : null;
    const ph = drag.ph;

    let targetColId = null, beforeCardId = null;
    if(column){
      const list = column.querySelector('.cards');
      targetColId = list.getAttribute('data-cards');
      const next = ph.nextElementSibling;
      beforeCardId = (next && next.classList.contains('card')) ? next.getAttribute('data-card') : null;
    }

    drag.ghost.remove();
    const cardHidden = document.querySelector(`[data-card="${drag.cardId}"]`);
    if(cardHidden){ cardHidden.style.visibility=''; }
    ph.remove();
    document.querySelectorAll('.column').forEach(c => c.classList.remove('focus'));

    if(!column){
      pendingDeleteId = drag.cardId;
      openConfirm();
    }else{
      moveCard(drag.cardId, targetColId, beforeCardId);
    }
    drag = null;
  }

  /* ========= Edge Auto-Scroll (cards & columns) ========= */
  function startAutoScroll(){
    if(rafId) cancelAnimationFrame(rafId);
    const loop = () => {
      if(!drag && !cDrag){ rafId = null; return; }
      const rect = boardEl.getBoundingClientRect();
      const x = lastPointer.x - rect.left;
      let vx = 0;
      if(x < SCROLL_ZONE){ vx = -interp(x, 0, SCROLL_ZONE, MAX_SPEED, 0); }
      else if(x > rect.width - SCROLL_ZONE){ vx = interp(x, rect.width - SCROLL_ZONE, rect.width, 0, MAX_SPEED); }

      if(vx !== 0){
        boardEl.scrollLeft += vx;
        if(drag) moveCardDrag(lastPointer.x, lastPointer.y);
        if(cDrag) moveColumnDrag(lastPointer.x);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }
  function stopAutoScroll(){
    if(rafId){ cancelAnimationFrame(rafId); rafId = null; }
  }
  function interp(v, a, b, outA, outB){
    const t = Math.max(0, Math.min(1, (v - a)/(b - a)));
    return outA + (outB - outA)*t;
  }

  /* ===========================
   * Column Reordering (drag header/grip)
   * =========================== */
  function startColumnDrag(e, colEl, colId){
    e.preventDefault();
    const rect = colEl.getBoundingClientRect();
    const ghost = colEl.cloneNode(true);
    ghost.style.width = rect.width+'px';
    ghost.classList.add('dragging');
    document.body.appendChild(ghost);

    const ph = document.createElement('div');
    ph.className = 'col-placeholder';
    ph.style.height = rect.height+'px';
    colEl.parentElement.insertBefore(ph, colEl);
    colEl.style.visibility='hidden';

    cDrag = { colId, ghost, ph, offsetX: e.clientX - rect.left };
    moveColumnDrag(e.clientX);

    window.addEventListener('pointermove', onColMove);
    window.addEventListener('pointerup', onColUp, {once:true});
    window.addEventListener('pointercancel', onColUp, {once:true});

    lastPointer.x = e.clientX;
    startAutoScroll();
  }

  function onColMove(ev){
    lastPointer.x = ev.clientX;
    moveColumnDrag(ev.clientX);
  }

  function onColUp(){
    stopAutoScroll();
    finishColumnDrag();
    window.removeEventListener('pointermove', onColMove);
  }

  function moveColumnDrag(clientX){
    if(!cDrag) return;
    const g = cDrag.ghost;
    g.style.left = (clientX - cDrag.offsetX) + 'px';
    g.style.top  = (boardEl.getBoundingClientRect().top + 8) + 'px';

    const cols = Array.from(boardEl.querySelectorAll('.column')).filter(c => c.style.visibility !== 'hidden');
    let before = null;
    for(const c of cols){
      const r = c.getBoundingClientRect();
      if(clientX < r.left + r.width/2){ before = c; break; }
    }
    if(before) boardEl.insertBefore(cDrag.ph, before);
    else boardEl.appendChild(cDrag.ph);
  }

  function finishColumnDrag(){
    if(!cDrag) return;

    const newOrderIds = [];
    boardEl.childNodes.forEach(node => {
      if(!(node instanceof HTMLElement)) return;
      if(node.classList.contains('col-placeholder')){
        newOrderIds.push(cDrag.colId);
      }else if(node.classList.contains('column')){
        const id = node.getAttribute('data-col');
        if(id !== cDrag.colId) newOrderIds.push(id);
      }
    });

    const seen = new Set();
    const orderedUnique = newOrderIds.filter(id => (id && !seen.has(id)) && (seen.add(id) || true));
    state.columns = orderedUnique.map(id => state.columns.find(c => c.id === id));

    saveState();

    cDrag.ghost.remove();
    const hidden = boardEl.querySelector(`[data-col="${cDrag.colId}"]`);
    if(hidden) hidden.style.visibility='';
    cDrag.ph.remove();
    cDrag = null;

    renderBoard();
  }

  // ===== Sideways scrolling: mouse tilt/shift-wheel + Shift+Arrow keys
  boardEl.addEventListener('wheel', (e) => {
    const wantsHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
    if(!wantsHorizontal) return;
    e.preventDefault();
    const delta = (Math.abs(e.deltaX) > 0 ? e.deltaX : e.deltaY);
    boardEl.scrollLeft += delta;
  }, {passive:false});

  window.addEventListener('keydown', (e) => {
    if(!e.shiftKey) return;
    if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
      e.preventDefault();
      const step = 80;
      boardEl.scrollLeft += (e.key === 'ArrowRight' ? step : -step);
    }
  });

  // ===== Events
  fab.addEventListener('click', () => openSheet('add'));
  cancelAddBtn.addEventListener('click', closeSheet);
  saveAddBtn.addEventListener('click', saveFromSheet);
  taskTitle.addEventListener('keydown', e => { if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveFromSheet(); });

  // Close "Add Task" by clicking outside, only if nothing was typed yet
function isSheetEmpty(){
  return !taskTitle.value.trim() &&
         !taskDue.value &&
         !taskTime.value &&
         !taskTags.value.trim() &&
         !taskNotes.value.trim() &&
         (!taskColor.value || taskColor.value.toLowerCase() === '#ffffff');
}

modal.addEventListener('click', (e) => {
  if (e.target === modal && editContext?.mode === 'add' && isSheetEmpty()) {
    closeSheet();
  }
});

  addColumnBtn.addEventListener('click', () => {
    const name = prompt('Category name:', 'New Category');
    if(name) addColumn(name.trim());
  });
  exportBtn.addEventListener('click', exportBoard);
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', e => {
    const f = e.target.files?.[0]; if(f) importBoard(f);
    importInput.value = '';
  });
  clearBtn.addEventListener('click', clearAll);

  function openHelp(){ helpModal.classList.add('open'); }
document.getElementById('helpBtn').addEventListener('click', openHelp);

  /* ===========================
   * First-load Quick Guide: show once and remember
   * =========================== */
  function openHelpIfFirstTime(){
    try{
      const shown = localStorage.getItem(HELP_KEY);
      if(!shown){
        helpModal.classList.add('open');
        localStorage.setItem(HELP_KEY, '1');
      }
    }catch(e){
      // If storage fails, still show once per session
      helpModal.classList.add('open');
    }
  }
  function closeHelp(){
    helpModal.classList.remove('open');
  }
  // Click outside the panel to dismiss
  helpModal?.addEventListener('click', (e) => {
    if(e.target === helpModal) closeHelp();
  });
  // Escape to dismiss
  window.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && helpModal.classList.contains('open')) closeHelp();
  });

  // ===== Init
  renderBoard();
  openHelpIfFirstTime();
})();
