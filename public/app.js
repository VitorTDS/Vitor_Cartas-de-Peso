const app = document.querySelector('#app');

const state = {
  token: localStorage.getItem('token'),
  usuario: JSON.parse(localStorage.getItem('usuario') || 'null'),
  usuarios: [],
  selectedUserId: Number(localStorage.getItem('selectedUserId') || 0),
  tab: localStorage.getItem('tab') || 'cartas',
  lockStatus: 'Identifique-se para acessar o controle.',
  controle: null,
  saving: false,
  toast: '',
  saveTimer: null,
};

const perfilLabel = {
  administrador: 'Administrador',
  producao: 'Producao',
  qualidade: 'Qualidade',
  supervisor: 'Supervisor',
  consulta_auditoria: 'Consulta/Auditoria',
};

const h = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

const dataLocal = (date = new Date()) => {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
};
const hoje = () => dataLocal();
const horaAgora = () => new Date().toTimeString().slice(0, 5);
const parseNumero = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};
const fmt = (value, digits = 2) => Number(value || 0).toLocaleString('pt-BR', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body.error?.message || 'Nao foi possivel concluir a operacao.');
    error.status = res.status;
    error.code = body.error?.code;
    if (res.status === 401 && state.token) {
      limparSessao('Sua sessao expirou. Entre novamente.');
    }
    throw error;
  }
  return body;
}

function setToast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    state.toast = '';
    render();
  }, 2600);
}

async function carregarLock() {
  const body = await api('/api/lock/users');
  state.usuarios = body.data || [];
  if (!state.selectedUserId && state.usuarios[0]) {
    state.selectedUserId = state.usuarios[0].id;
    localStorage.setItem('selectedUserId', String(state.selectedUserId));
  }
}

async function carregarControle() {
  state.controle = await api('/api/controle-densidade');
}

function avatar(usuario) {
  const nome = usuario?.nomeExibicao || usuario?.nome || '?';
  const iniciais = nome.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return `<span class="avatar">${h(iniciais)}</span>`;
}

function lockView() {
  const selected = state.usuarios.find((user) => user.id === state.selectedUserId) || state.usuarios[0];
  app.innerHTML = `
    <section class="lock-screen">
      <aside class="lock-users">
        <div class="brand"><span class="mark">D</span><div><h1>Controle de Densidade</h1><small>Volume pela densidade</small></div></div>
        <div class="lock-list">
          ${state.usuarios.map((user) => `
            <button class="lock-user ${selected?.id === user.id ? 'active' : ''}" type="button" data-user="${user.id}">
              ${avatar(user)}
              <span><strong>${h(user.nomeExibicao || user.nome)}</strong><small>${h(perfilLabel[user.perfil] || user.perfil)}</small></span>
            </button>
          `).join('')}
        </div>
      </aside>
      <main class="lock-main">
        <form id="lockForm" class="login-card">
          <h2>${selected ? h(selected.nome) : 'Nenhum usuario ativo'}</h2>
          <input type="hidden" name="usuarioId" value="${selected?.id || ''}">
          <div class="login-status">${h(state.lockStatus)}</div>
          <label>Senha
            <input name="pin" type="password" autocomplete="current-password" required autofocus>
          </label>
          <div class="actions">
            <button type="submit">Entrar</button>
          </div>
        </form>
      </main>
    </section>
  `;
  document.querySelectorAll('[data-user]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedUserId = Number(button.dataset.user);
      localStorage.setItem('selectedUserId', String(state.selectedUserId));
      state.lockStatus = 'Digite sua senha para entrar.';
      render();
    });
  });
  document.querySelector('#lockForm')?.addEventListener('submit', authPin);
}

async function authPin(event) {
  event.preventDefault();
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const body = await api('/api/lock/auth', {
      method: 'POST',
      body: JSON.stringify({ ...payload, metodo: 'pin' }),
    });
    state.token = body.token;
    state.usuario = body.usuario;
    localStorage.setItem('token', body.token);
    localStorage.setItem('usuario', JSON.stringify(body.usuario));
    await carregarControle();
    render();
  } catch (err) {
    state.lockStatus = err.message;
    render();
  }
}

async function cadastrarUsuario(event) {
  event.preventDefault();
  const form = event.currentTarget;
  state.saving = true;
  renderStatus();
  try {
    await api('/api/usuarios', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    await carregarLock();
    setToast('Usuario cadastrado.');
  } catch (err) {
    setToast(err.message);
  } finally {
    state.saving = false;
    render();
  }
}

function limparSessao(message) {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  state.token = null;
  state.usuario = null;
  state.controle = null;
  state.lockStatus = message;
}

function sair() {
  limparSessao('Sessao encerrada.');
  carregarLock().finally(render);
}

function setTab(tab) {
  state.tab = tab;
  localStorage.setItem('tab', tab);
  render();
}

function atualizarCabecalho(campo, value) {
  state.controle.cabecalho[campo] = value;
  if (campo === 'volumeDeclaradoMl' || campo === 'variacaoPermitidaPercentual') {
    const cab = state.controle.cabecalho;
    const declarado = parseNumero(cab.volumeDeclaradoMl);
    const variacao = parseNumero(cab.variacaoPermitidaPercentual) / 100;
    cab.minimoMl = declarado;
    cab.maximoMl = declarado * (1 + variacao);
    const minimo = document.querySelector('[data-head="minimoMl"]');
    const maximo = document.querySelector('[data-head="maximoMl"]');
    if (minimo) minimo.value = cab.minimoMl;
    if (maximo) maximo.value = cab.maximoMl;
  }
  salvarDepois();
  renderCalculos();
  renderVolumes();
}

function atualizarVerificacao(index, campo, value) {
  state.controle.verificacoes[index][campo] = value;
  salvarDepois();
}

function atualizarPeso(coluna, linha, value) {
  state.controle.verificacoes[coluna].pesos[linha] = parseNumero(value);
  salvarDepois();
  renderCalculos();
  renderVolumes();
}

function novaVerificacao() {
  if (state.controle.verificacoes.length >= 13) {
    setToast('A ficha permite no máximo 13 verificações.');
    return;
  }
  const anterior = state.controle.verificacoes.at(-1);
  let data = hoje();
  let hora = horaAgora();
  if (anterior?.data && anterior?.hora) {
    const prevista = new Date(`${anterior.data}T${anterior.hora}:00`);
    prevista.setMinutes(prevista.getMinutes() + parseNumero(state.controle.cabecalho.frequenciaMinutos || 30));
    data = dataLocal(prevista);
    hora = prevista.toTimeString().slice(0, 5);
  }
  state.controle.verificacoes.push({
    id: `${Date.now()}`,
    realizadoPor: state.usuario?.nomeExibicao || state.usuario?.nome || '',
    data,
    hora,
    pesos: Array.from({ length: 10 }, () => 0),
  });
  salvarAgora();
  render();
}

function removerVerificacao(index) {
  state.controle.verificacoes.splice(index, 1);
  salvarAgora();
  render();
}

function salvarDepois() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(salvarAgora, 500);
}

async function salvarAgora() {
  clearTimeout(state.saveTimer);
  state.saving = true;
  renderStatus();
  try {
    state.controle = await api('/api/controle-densidade', {
      method: 'PUT',
      body: JSON.stringify(state.controle),
    });
  } catch (err) {
    setToast(err.message);
  } finally {
    state.saving = false;
    renderStatus();
  }
}

function calculos(verificacao) {
  const pesos = verificacao.pesos.map(parseNumero);
  const informados = pesos.filter((value) => value > 0);
  const media = informados.length ? informados.reduce((sum, value) => sum + value, 0) / informados.length : 0;
  const cab = state.controle.cabecalho;
  const densidadeDeclarada = parseNumero(cab.densidadeDeclarada);
  const tara = parseNumero(cab.pesoEmbalagemPrimariaG);
  const volumes = pesos.map((peso) => (peso > 0 && densidadeDeclarada > 0 ? (peso - tara) / densidadeDeclarada : 0));
  const volumesInformados = volumes.filter((value) => value > 0);
  const volume = volumesInformados.length
    ? volumesInformados.reduce((sum, value) => sum + value, 0) / volumesInformados.length
    : 0;
  return {
    media,
    volumes,
    volume,
    completa: informados.length === 10,
    volumeFora: Boolean(volume) && (volume < parseNumero(cab.minimoMl) || volume > parseNumero(cab.maximoMl)),
  };
}

function field(label, campo, type = 'text', step = '', readonly = false) {
  const value = state.controle.cabecalho[campo];
  return `
    <label>${label}
      <input data-head="${campo}" type="${type}" ${step ? `step="${step}"` : ''} ${readonly ? 'readonly aria-readonly="true"' : ''} value="${h(value)}">
    </label>
  `;
}

function controleView() {
  const cab = state.controle.cabecalho;
  const admin = state.usuario?.perfil === 'administrador';
  const tab = state.tab === 'usuarios' && !admin ? 'cartas' : state.tab;
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <h1>Controle de Densidade - Volume pela Densidade</h1>
          <p>Frequencia: a cada ${fmt(cab.frequenciaMinutos, 0)} minutos, tolerancia de ${fmt(cab.toleranciaMinutos, 0)} minutos</p>
        </div>
        <div class="userbox">
          <strong>${h(state.usuario?.nomeExibicao || state.usuario?.nome)}</strong>
          <span id="saveStatus">Dados carregados</span>
          <button class="secondary" id="logoutBtn" type="button">Sair</button>
        </div>
      </header>

      <nav class="tabs" aria-label="Acoes internas">
        <button type="button" class="${tab === 'cartas' ? 'active' : ''}" data-tab="cartas">Cartas</button>
        ${admin ? `<button type="button" class="${tab === 'usuarios' ? 'active' : ''}" data-tab="usuarios">Usuários</button>` : ''}
      </nav>

      ${state.toast ? `<div class="toast">${h(state.toast)}</div>` : ''}

      ${tab === 'cartas' ? cartasTab() : usuariosTab()}
    </div>
  `;
  bindTela();
  renderTabela();
  renderStatus();
}

controleView = function controleViewSidebar() {
  const admin = state.usuario?.perfil === 'administrador';
  const tab = state.tab === 'usuarios' && !admin ? 'cartas' : state.tab;
  app.innerHTML = `
    <div class="app-shell split-shell">
      <aside class="internal-sidebar">
        <div class="internal-brand">
          <span class="mark">D</span>
          <div>
            <h1>Controle de Densidade</h1>
            <small>Volume pela densidade</small>
          </div>
        </div>
        <div class="internal-user">
          <strong>${h(state.usuario?.nomeExibicao || state.usuario?.nome)}</strong>
          <span id="saveStatus">Dados carregados</span>
        </div>
        <nav class="internal-tabs" aria-label="Acoes internas">
          <button type="button" class="${tab === 'cartas' ? 'active' : ''}" data-tab="cartas">Cartas</button>
          ${admin ? `<button type="button" class="${tab === 'usuarios' ? 'active' : ''}" data-tab="usuarios">Usuários</button>` : ''}
        </nav>
        <button class="secondary" id="logoutBtn" type="button">Sair</button>
      </aside>
      <main class="internal-main">
        ${state.toast ? `<div class="toast">${h(state.toast)}</div>` : ''}
        ${tab === 'cartas' ? cartasTab() : usuariosTab()}
      </main>
    </div>
  `;
  bindTela();
  renderTabela();
  renderStatus();
};

function cartasTab() {
  const cab = state.controle.cabecalho;
  return `
    <section class="module">
      <div class="section-title">
        <h2>Cartas de peso</h2>
        <div class="actions">
          <button class="secondary" id="csvBtn" type="button">Exportar CSV</button>
          <button class="secondary" id="excelBtn" type="button">Exportar Excel</button>
          <button id="addColumnBtn" type="button">Adicionar verificacao</button>
        </div>
      </div>
      <div class="card-shortcuts">
        <button class="card-shortcut active" type="button" data-card-shortcut="tipo1">
          <strong>Tipo de carta 1</strong>
          <span>Aguardando especificacao</span>
        </button>
        <button class="card-shortcut" type="button" data-card-shortcut="tipo2">
          <strong>Tipo de carta 2</strong>
          <span>Aguardando especificacao</span>
        </button>
      </div>
      <div class="header-grid">
        ${field('Produto', 'produto')}
        ${field('Lote', 'lote')}
        ${field('Volume declarado (mL)', 'volumeDeclaradoMl', 'number', '0.01')}
        ${field('Variacao permitida (%)', 'variacaoPermitidaPercentual', 'number', '0.01')}
        ${field('Densidade (g/mL)', 'densidadeDeclarada', 'number', '0.0001')}
        ${field('Peso Emb. Primaria (g)', 'pesoEmbalagemPrimariaG', 'number', '0.01')}
        ${field('Minimo (mL) — automatico', 'minimoMl', 'number', '0.01', true)}
        ${field('Maximo (mL) — automatico', 'maximoMl', 'number', '0.01', true)}
        ${field('Maquina (TAG)', 'maquinaTag')}
        ${field('Linha', 'linha')}
        ${field('TAG Balanca', 'tagBalanca')}
        ${field('Frequencia (min)', 'frequenciaMinutos', 'number', '1')}
        ${field('Tolerancia (min)', 'toleranciaMinutos', 'number', '1')}
      </div>
      <p class="legend">Se os valores de media e densidade estiverem diferentes, ficarao vermelhos e deverao ser reavaliados.</p>
    </section>
    <section class="module">
      <div class="section-title">
        <h2>Tabela de pesagens</h2>
        <span class="hint">${state.controle.verificacoes.length} verificacao(oes)</span>
      </div>
      <div id="densityTable"></div>
    </section>
  `;
}

function usuariosTab() {
  return adminUsersTab();
}

function painelUsuarios() {
  return `
    <section class="module">
      <div class="section-title">
        <div>
          <h2>Usuarios</h2>
          <span class="hint">Cadastre os usuarios que podem acessar o sistema com senha.</span>
        </div>
      </div>
      <form id="usuarioForm" class="user-form">
        <div class="user-form-grid">
          <label>Nome completo<input name="nome" required></label>
          <label>Nome de exibicao<input name="nomeExibicao" required></label>
          <label>Matricula/codigo<input name="matricula"></label>
          <label>Setor<input name="setor"></label>
          <label>Cargo<input name="cargo"></label>
          <label>E-mail<input name="email" type="email" required></label>
          <label>Perfil
            <select name="perfil">
              <option value="producao">Producao</option>
              <option value="qualidade">Qualidade</option>
              <option value="supervisor">Supervisor</option>
              <option value="consulta_auditoria">Consulta/Auditoria</option>
              <option value="administrador">Administrador</option>
            </select>
          </label>
          <label>Status
            <select name="status">
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </label>
          <label>Senha inicial<input name="senha" type="password" required></label>
        </div>
        <div class="actions">
          <button type="submit">Cadastrar usuario</button>
        </div>
      </form>
      <hr>
      <div class="user-grid">
        ${state.usuarios.map((user) => `
          <div class="user-card">
            <div>
              <strong>${h(user.nomeExibicao || user.nome)}</strong>
              <span>${h(perfilLabel[user.perfil] || user.perfil)} - ${h(user.email)}</span>
              <small>${user.status === 'ativo' ? 'Ativo' : 'Inativo'}</small>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function adminUsersTab() {
  if (state.usuario?.perfil !== 'administrador') return '';
  return painelUsuarios();
}

function renderTabela() {
  const target = document.querySelector('#densityTable');
  if (!target || !state.controle) return;
  const cols = state.controle.verificacoes;
  target.innerHTML = `
    <div class="table-wrap">
      <table class="density-table">
        <thead>
          <tr>
            <th class="row-head">Campo</th>
            ${cols.map((_, index) => `<th>Verificacao ${index + 1}<button class="icon-btn" title="Remover verificacao" type="button" data-remove="${index}">x</button></th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${linhaMeta('Realizado por', 'realizadoPor', 'text')}
          ${linhaMeta('Data', 'data', 'date')}
          ${linhaMeta('Hora', 'hora', 'time')}
          ${Array.from({ length: 10 }, (_, index) => linhaPeso(index)).join('')}
          ${Array.from({ length: 10 }, (_, index) => linhaVolume(index)).join('')}
          ${linhaCalculada('Peso medio', (calc) => calc.media ? `${fmt(calc.media, 2)} g` : '—')}
          ${linhaCalculada('MEDIA (mL)', (calc) => calc.volume ? `${fmt(calc.volume, 2)} mL${calc.completa ? '' : ' (parcial)'}` : '—', 'volumeFora')}
        </tbody>
      </table>
    </div>
  `;
  target.querySelectorAll('[data-meta]').forEach((input) => {
    input.addEventListener('input', () => atualizarVerificacao(Number(input.dataset.col), input.dataset.meta, input.value));
  });
  target.querySelectorAll('[data-peso]').forEach((input) => {
    input.addEventListener('input', () => atualizarPeso(Number(input.dataset.col), Number(input.dataset.peso), input.value));
  });
  target.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => removerVerificacao(Number(button.dataset.remove)));
  });
}

function linhaMeta(label, campo, type) {
  return `<tr><th class="row-head">${label}</th>${state.controle.verificacoes.map((verificacao, index) => `
    <td><input data-col="${index}" data-meta="${campo}" type="${type}" value="${h(verificacao[campo])}"></td>
  `).join('')}</tr>`;
}

function linhaPeso(index) {
  return `<tr><th class="row-head">${index + 1}o peso (g)</th>${state.controle.verificacoes.map((verificacao, col) => `
    <td><input data-col="${col}" data-peso="${index}" type="number" step="0.01" value="${h(verificacao.pesos[index] || '')}"></td>
  `).join('')}</tr>`;
}

function linhaVolume(index) {
  return `<tr class="calc-row"><th class="row-head">${index + 1}o volume (mL)</th>${state.controle.verificacoes.map((verificacao, col) => {
    const calc = calculos(verificacao);
    const volume = calc.volumes[index];
    const fora = Boolean(volume) && (volume < parseNumero(state.controle.cabecalho.minimoMl) || volume > parseNumero(state.controle.cabecalho.maximoMl));
    return `<td data-volume-index="${index}" data-col="${col}" class="${fora ? 'bad-cell' : ''}">${volume ? `${fmt(volume, 2)} mL` : '—'}</td>`;
  }).join('')}</tr>`;
}

function renderVolumes() {
  document.querySelectorAll('[data-volume-index]').forEach((cell) => {
    const calc = calculos(state.controle.verificacoes[Number(cell.dataset.col)]);
    const volume = calc.volumes[Number(cell.dataset.volumeIndex)];
    const cab = state.controle.cabecalho;
    const fora = Boolean(volume) && (volume < parseNumero(cab.minimoMl) || volume > parseNumero(cab.maximoMl));
    cell.textContent = volume ? `${fmt(volume, 2)} mL` : '—';
    cell.classList.toggle('bad-cell', fora);
  });
}

function linhaCalculada(label, formatter, flag = '') {
  return `<tr class="calc-row"><th class="row-head">${label}</th>${state.controle.verificacoes.map((verificacao) => {
    const calc = calculos(verificacao);
    return `<td data-calc-label="${h(label)}" data-calc-flag="${h(flag)}" class="${flag && calc[flag] ? 'bad-cell' : ''}">${formatter(calc)}</td>`;
  }).join('')}</tr>`;
}

function renderCalculos() {
  const labels = {
    'Peso medio': (calc) => calc.media ? `${fmt(calc.media, 2)} g` : '—',
    'MEDIA (mL)': (calc) => calc.volume ? `${fmt(calc.volume, 2)} mL${calc.completa ? '' : ' (parcial)'}` : '—',
  };
  document.querySelectorAll('[data-calc-label]').forEach((cell, index) => {
    const col = index % Math.max(1, state.controle.verificacoes.length);
    const calc = calculos(state.controle.verificacoes[col]);
    const flag = cell.dataset.calcFlag;
    cell.textContent = labels[cell.dataset.calcLabel](calc);
    cell.classList.toggle('bad-cell', Boolean(flag && calc[flag]));
  });
}

function bindTela() {
  document.querySelector('#logoutBtn').addEventListener('click', sair);
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  });
  document.querySelector('#addColumnBtn')?.addEventListener('click', novaVerificacao);
  document.querySelector('#csvBtn')?.addEventListener('click', exportarCsv);
  document.querySelector('#excelBtn')?.addEventListener('click', exportarExcel);
  document.querySelector('#usuarioForm')?.addEventListener('submit', cadastrarUsuario);
  document.querySelectorAll('[data-card-shortcut]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-card-shortcut]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
    });
  });
  document.querySelectorAll('[data-head]').forEach((input) => {
    input.addEventListener('input', () => {
      const numeric = input.type === 'number';
      atualizarCabecalho(input.dataset.head, numeric ? parseNumero(input.value) : input.value);
    });
  });
}

function renderStatus() {
  const status = document.querySelector('#saveStatus');
  if (status) status.textContent = state.saving ? 'Salvando...' : 'Salvo no banco';
}

function linhasExportacao() {
  const cab = state.controle.cabecalho;
  const cols = state.controle.verificacoes;
  const rows = [
    ['Produto', cab.produto],
    ['Lote', cab.lote],
    ['Volume declarado (mL)', cab.volumeDeclaradoMl],
    ['Variacao permitida (%)', cab.variacaoPermitidaPercentual],
    ['Densidade (g/mL)', cab.densidadeDeclarada],
    ['Peso Emb. Primaria (g)', cab.pesoEmbalagemPrimariaG],
    ['Minimo (mL)', cab.minimoMl],
    ['Maximo (mL)', cab.maximoMl],
    ['Maquina (TAG)', cab.maquinaTag],
    ['Linha', cab.linha],
    ['TAG Balanca', cab.tagBalanca],
    ['Frequencia', `a cada ${cab.frequenciaMinutos} minutos, tolerancia de ${cab.toleranciaMinutos} minutos`],
    [],
    ['Campo', ...cols.map((_, index) => `Verificacao ${index + 1}`)],
    ['Realizado por', ...cols.map((col) => col.realizadoPor)],
    ['Data', ...cols.map((col) => col.data)],
    ['Hora', ...cols.map((col) => col.hora)],
    ...Array.from({ length: 10 }, (_, index) => [`${index + 1}o peso (g)`, ...cols.map((col) => col.pesos[index] || '')]),
    ['Media', ...cols.map((col) => fmt(calculos(col).media, 2))],
    ['Densidade', ...cols.map((col) => fmt(calculos(col).densidade, 4))],
    ['MEDIA (mL)', ...cols.map((col) => fmt(calculos(col).volume, 2))],
  ];
  return rows;
}

function baixar(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

function exportarCsv() {
  const csv = linhasExportacao().map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';')).join('\n');
  baixar('controle-densidade.csv', csv, 'text/csv;charset=utf-8');
}

function exportarExcel() {
  const html = `<html><head><meta charset="utf-8"></head><body><table>${linhasExportacao().map((row) => (
    `<tr>${row.map((cell) => `<td>${h(cell)}</td>`).join('')}</tr>`
  )).join('')}</table></body></html>`;
  baixar('controle-densidade.xls', html, 'application/vnd.ms-excel;charset=utf-8');
}

function render() {
  if (!state.token) return lockView();
  if (!state.controle) return app.innerHTML = '<main class="loading">Carregando controle...</main>';
  return controleView();
}

(async function init() {
  try {
    localStorage.removeItem('digitalSelecionada');
    await carregarLock();
    if (state.token) await carregarControle();
    render();
  } catch (err) {
    if (err.status !== 401) state.lockStatus = err.message;
    render();
  }
}());
