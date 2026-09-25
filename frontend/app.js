const app = document.querySelector('#app');

const state = {
  usuario: null,
  usuarios: [],
  tab: localStorage.getItem('tab') || 'cartas',
  lockStatus: 'Identifique-se para acessar o controle.',
  controle: null,
  saving: false,
  toast: '',
  saveTimer: null,
  sessionTimer: null,
  sessionExpiresAt: 0,
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
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body.error?.message || 'Nao foi possivel concluir a operacao.');
    error.status = res.status;
    error.code = body.error?.code;
    if (res.status === 401 && state.usuario && path !== '/api/change-password') {
      limparSessao('Sua sessao expirou. Entre novamente.');
      render();
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

async function carregarUsuarios() {
  if (state.usuario?.perfil !== 'administrador') return;
  const body = await api('/api/usuarios');
  state.usuarios = body.data || [];
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
  app.innerHTML = `
    <section class="lock-screen">
      <aside class="lock-users">
        <div class="brand"><span class="mark">D</span><div><h1>Controle de Densidade</h1><small>Volume pela densidade</small></div></div>
        <div class="login-info">
          <span class="eyebrow">Acesso protegido</span>
          <h2>Controle confiável do início ao fim.</h2>
          <p>Sua sessão permanece ativa por 50 minutos. Depois desse período, o sistema entra em suspensão automaticamente.</p>
          <ul>
            <li>Dados protegidos por perfil de acesso</li>
            <li>Alterações registradas em auditoria</li>
            <li>Sessão encerrada automaticamente</li>
          </ul>
        </div>
      </aside>
      <main class="lock-main">
        <form id="lockForm" class="login-card">
          <span class="eyebrow">Bem-vindo</span>
          <h2>Entre no sistema</h2>
          <p>Use seu e-mail corporativo e sua senha.</p>
          <div class="login-status">${h(state.lockStatus)}</div>
          <label>E-mail
            <input name="email" type="email" autocomplete="username" required autofocus>
          </label>
          <label>Senha
            <input name="senha" type="password" autocomplete="current-password" required>
          </label>
          <div class="actions">
            <button type="submit">Entrar</button>
          </div>
        </form>
      </main>
    </section>
  `;
  document.querySelector('#lockForm')?.addEventListener('submit', autenticar);
}

async function autenticar(event) {
  event.preventDefault();
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const body = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.usuario = body.usuario;
    agendarSuspensao(body.sessaoExpiraEm);
    if (!state.usuario.deveTrocarSenha) {
      await carregarControle();
      await carregarUsuarios();
    }
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
    await carregarUsuarios();
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
  sessionStorage.removeItem('sessionExpiresAt');
  clearTimeout(state.sessionTimer);
  state.sessionTimer = null;
  state.sessionExpiresAt = 0;
  state.usuario = null;
  state.usuarios = [];
  state.controle = null;
  state.lockStatus = message;
}

async function sair() {
  try {
    await api('/api/logout', { method: 'POST', body: '{}' });
  } finally {
    limparSessao('Sessão encerrada.');
    render();
  }
}

function agendarSuspensao(expiresAt) {
  clearTimeout(state.sessionTimer);
  state.sessionExpiresAt = Number(expiresAt || 0);
  sessionStorage.setItem('sessionExpiresAt', String(state.sessionExpiresAt));
  const restante = Math.max(0, state.sessionExpiresAt - Date.now());
  state.sessionTimer = setTimeout(() => suspenderSessao(), restante);
}

async function suspenderSessao() {
  if (!state.usuario) return;
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    try { await salvarAgora(); } catch { /* a sessão pode vencer durante o último salvamento */ }
  }
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } finally {
    limparSessao('Sistema suspenso após 50 minutos. Entre novamente para continuar.');
    render();
  }
}

function passwordChangeView() {
  app.innerHTML = `
    <section class="lock-screen password-change-screen">
      <aside class="lock-users">
        <div class="brand"><span class="mark">D</span><div><h1>Controle de Densidade</h1><small>Proteção da conta</small></div></div>
        <div class="login-info">
          <span class="eyebrow">Primeiro acesso</span>
          <h2>Crie uma senha somente sua.</h2>
          <p>A nova senha deve ter pelo menos 10 caracteres e combinar três destes grupos:</p>
          <ul><li>Letras maiúsculas</li><li>Letras minúsculas</li><li>Números</li><li>Símbolos</li></ul>
        </div>
      </aside>
      <main class="lock-main">
        <form id="passwordChangeForm" class="login-card">
          <span class="eyebrow">Segurança obrigatória</span>
          <h2>Troque sua senha inicial</h2>
          <div class="login-status">${h(state.lockStatus)}</div>
          <label>Senha atual<input name="senhaAtual" type="password" autocomplete="current-password" required></label>
          <label>Nova senha<input name="novaSenha" type="password" autocomplete="new-password" minlength="10" required></label>
          <label>Confirmar nova senha<input name="confirmacao" type="password" autocomplete="new-password" minlength="10" required></label>
          <div class="actions"><button type="submit">Salvar nova senha</button></div>
        </form>
      </main>
    </section>
  `;
  document.querySelector('#passwordChangeForm')?.addEventListener('submit', trocarSenhaInicial);
}

async function trocarSenhaInicial(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  if (payload.novaSenha !== payload.confirmacao) {
    state.lockStatus = 'A confirmação não corresponde à nova senha.';
    return render();
  }
  try {
    const body = await api('/api/change-password', {
      method: 'POST',
      body: JSON.stringify({ senhaAtual: payload.senhaAtual, novaSenha: payload.novaSenha }),
    });
    state.usuario = body.usuario;
    state.lockStatus = 'Senha atualizada com sucesso.';
    agendarSuspensao(body.sessaoExpiraEm);
    await carregarControle();
    await carregarUsuarios();
    render();
  } catch (err) {
    state.lockStatus = err.message;
    render();
  }
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
            <small>Sobral · Qualidade industrial</small>
          </div>
        </div>
        <div class="internal-user">
          ${avatar(state.usuario)}
          <div>
            <strong>${h(state.usuario?.nomeExibicao || state.usuario?.nome)}</strong>
            <span>${h(perfilLabel[state.usuario?.perfil] || state.usuario?.perfil)}</span>
          </div>
        </div>
        <nav class="internal-tabs" aria-label="Acoes internas">
          <span class="nav-label">Menu principal</span>
          <button type="button" class="${tab === 'cartas' ? 'active' : ''}" data-tab="cartas"><span aria-hidden="true">▦</span> Cartas de peso</button>
          ${admin ? `<button type="button" class="${tab === 'usuarios' ? 'active' : ''}" data-tab="usuarios"><span aria-hidden="true">♙</span> Usuários</button>` : ''}
        </nav>
        <div class="sidebar-footer">
          <span class="save-indicator"><i aria-hidden="true"></i><span id="saveStatus">Dados carregados</span></span>
          <button class="secondary" id="logoutBtn" type="button">Sair do sistema</button>
        </div>
      </aside>
      <main class="internal-main">
        <header class="workspace-header">
          <div>
            <span class="eyebrow">Controle de processo</span>
            <h1>${tab === 'cartas' ? 'Cartas de peso' : 'Gestão de usuários'}</h1>
            <p>${tab === 'cartas' ? `Acompanhamento de volume por densidade a cada ${fmt(state.controle.cabecalho.frequenciaMinutos, 0)} minutos.` : 'Cadastre e gerencie os acessos da equipe.'}</p>
          </div>
          <div class="workspace-date">${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date())}</div>
        </header>
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
        <div>
          <span class="eyebrow">Parâmetros da carta</span>
          <h2>Dados do processo</h2>
          <p class="section-description">Informe os dados do lote e os limites usados nos cálculos.</p>
        </div>
        <div class="actions">
          <button class="secondary" id="csvBtn" type="button">Baixar CSV</button>
          <button class="secondary" id="excelBtn" type="button">Baixar Excel</button>
          <button id="addColumnBtn" type="button">+ Nova verificação</button>
        </div>
      </div>
      <div class="header-grid">
        ${field('Produto', 'produto')}
        ${field('Lote', 'lote')}
        ${field('Volume declarado (mL)', 'volumeDeclaradoMl', 'number', '0.01')}
        ${field('Variacao permitida (%)', 'variacaoPermitidaPercentual', 'number', '0.01')}
        ${field('Densidade (g/mL)', 'densidadeDeclarada', 'number', '0.0001')}
        ${field('Peso Emb. Primaria (g)', 'pesoEmbalagemPrimariaG', 'number', '0.01')}
        ${field('Mínimo (mL) — automático', 'minimoMl', 'number', '0.01', true)}
        ${field('Máximo (mL) — automático', 'maximoMl', 'number', '0.01', true)}
        ${field('Maquina (TAG)', 'maquinaTag')}
        ${field('Linha', 'linha')}
        ${field('TAG Balanca', 'tagBalanca')}
        ${field('Frequencia (min)', 'frequenciaMinutos', 'number', '1')}
        ${field('Tolerancia (min)', 'toleranciaMinutos', 'number', '1')}
      </div>
      <p class="legend"><strong>Atenção aos limites:</strong> valores fora da faixa permitida serão destacados em vermelho para reavaliação.</p>
    </section>
    <section class="module">
      <div class="section-title">
        <div>
          <span class="eyebrow">Monitoramento</span>
          <h2>Registro de pesagens</h2>
          <p class="section-description">Preencha os pesos; os volumes são calculados automaticamente.</p>
        </div>
        <span class="count-badge">${state.controle.verificacoes.length} ${state.controle.verificacoes.length === 1 ? 'verificação' : 'verificações'}</span>
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
          <span class="eyebrow">Controle de acesso</span>
          <h2>Novo usuário</h2>
          <p class="section-description">Cadastre as pessoas que podem acessar o sistema.</p>
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
          <label>Senha inicial<input name="senha" type="password" minlength="10" required></label>
        </div>
        <div class="actions">
          <button type="submit">Cadastrar usuário</button>
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
            ${cols.map((_, index) => `<th>Verificação ${index + 1}<button class="icon-btn" title="Remover verificação" aria-label="Remover verificação ${index + 1}" type="button" data-remove="${index}">×</button></th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${linhaMeta('Realizado por', 'realizadoPor', 'text')}
          ${linhaMeta('Data', 'data', 'date')}
          ${linhaMeta('Hora', 'hora', 'time')}
          ${Array.from({ length: 10 }, (_, index) => linhaPeso(index)).join('')}
          ${Array.from({ length: 10 }, (_, index) => linhaVolume(index)).join('')}
          ${linhaCalculada('Peso médio', (calc) => calc.media ? `${fmt(calc.media, 2)} g` : '—')}
          ${linhaCalculada('Média (mL)', (calc) => calc.volume ? `${fmt(calc.volume, 2)} mL${calc.completa ? '' : ' (parcial)'}` : '—', 'volumeFora')}
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
    'Peso médio': (calc) => calc.media ? `${fmt(calc.media, 2)} g` : '—',
    'Média (mL)': (calc) => calc.volume ? `${fmt(calc.volume, 2)} mL${calc.completa ? '' : ' (parcial)'}` : '—',
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
    ['Variação permitida (%)', cab.variacaoPermitidaPercentual],
    ['Densidade (g/mL)', cab.densidadeDeclarada],
    ['Peso Emb. Primária (g)', cab.pesoEmbalagemPrimariaG],
    ['Mínimo (mL)', cab.minimoMl],
    ['Máximo (mL)', cab.maximoMl],
    ['Máquina (TAG)', cab.maquinaTag],
    ['Linha', cab.linha],
    ['TAG Balança', cab.tagBalanca],
    ['Frequência', `a cada ${cab.frequenciaMinutos} minutos, tolerância de ${cab.toleranciaMinutos} minutos`],
    [],
    ['Campo', ...cols.map((_, index) => `Verificação ${index + 1}`)],
    ['Realizado por', ...cols.map((col) => col.realizadoPor)],
    ['Data', ...cols.map((col) => col.data)],
    ['Hora', ...cols.map((col) => col.hora)],
    ...Array.from({ length: 10 }, (_, index) => [`${index + 1}º peso (g)`, ...cols.map((col) => col.pesos[index] || '')]),
    ...Array.from({ length: 10 }, (_, index) => [`${index + 1}º volume (mL)`, ...cols.map((col) => calculos(col).volumes[index] || '')]),
    ['Peso médio (g)', ...cols.map((col) => calculos(col).media || '')],
    ['Média de volume (mL)', ...cols.map((col) => calculos(col).volume || '')],
    ['Situação', ...cols.map((col) => calculos(col).volumeFora ? 'Fora da faixa' : 'Conforme')],
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
  baixar(nomeArquivoExportacao('csv'), `\ufeff${csv}`, 'text/csv;charset=utf-8');
}

function nomeArquivoExportacao(extensao) {
  const lote = String(state.controle.cabecalho.lote || 'sem-lote')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `controle-densidade_${lote || 'sem-lote'}_${hoje()}.${extensao}`;
}

function exportarExcel() {
  const cab = state.controle.cabecalho;
  const cols = state.controle.verificacoes;
  const calculados = cols.map(calculos);
  const totalColunas = Math.max(cols.length + 1, 4);
  const texto = (value, classe = '') => `<td class="text ${classe}">${h(value)}</td>`;
  const numero = (value, casas = 2, classe = '') => {
    if (value === '' || value === null || value === undefined) return `<td class="number n${casas} ${classe}"></td>`;
    const parsed = parseNumero(value);
    return `<td class="number n${casas} ${classe}">${parsed}</td>`;
  };
  const parametros = [
    ['Produto', cab.produto, 'Lote', cab.lote],
    ['Volume declarado (mL)', cab.volumeDeclaradoMl, 'Variação permitida (%)', cab.variacaoPermitidaPercentual],
    ['Densidade (g/mL)', cab.densidadeDeclarada, 'Peso Emb. Primária (g)', cab.pesoEmbalagemPrimariaG],
    ['Mínimo (mL)', cab.minimoMl, 'Máximo (mL)', cab.maximoMl],
    ['Máquina (TAG)', cab.maquinaTag, 'Linha', cab.linha],
    ['TAG Balança', cab.tagBalanca, 'Frequência', `${cab.frequenciaMinutos} min (+/- ${cab.toleranciaMinutos} min)`],
  ];
  const linhasParametros = parametros.map(([labelA, valueA, labelB, valueB]) => `
    <tr>${texto(labelA, 'label')}${texto(valueA, 'value')}${texto(labelB, 'label')}${texto(valueB, 'value')}</tr>
  `).join('');
  const cabecalhoVerificacoes = `<tr><th class="row-label">Campo</th>${cols.map((_, index) => `<th>Verificação ${index + 1}</th>`).join('')}</tr>`;
  const linhaTexto = (label, values, classe = '') => `<tr>${texto(label, 'row-label')}${values.map((value) => texto(value, classe)).join('')}</tr>`;
  const linhaNumero = (label, values, casas, classes = []) => `<tr>${texto(label, 'row-label')}${values.map((value, index) => numero(value, casas, classes[index] || '')).join('')}</tr>`;
  const pesos = Array.from({ length: 10 }, (_, index) => linhaNumero(
    `${index + 1}º peso (g)`,
    cols.map((col) => col.pesos[index] || ''),
    2,
  )).join('');
  const volumes = Array.from({ length: 10 }, (_, index) => linhaNumero(
    `${index + 1}º volume (mL)`,
    calculados.map((calc) => calc.volumes[index] || ''),
    2,
    calculados.map((calc) => {
      const volume = calc.volumes[index];
      return volume && (volume < parseNumero(cab.minimoMl) || volume > parseNumero(cab.maximoMl)) ? 'alert' : '';
    }),
  )).join('');
  const resumo = [
    linhaNumero('Peso médio (g)', calculados.map((calc) => calc.media || ''), 2),
    linhaNumero('Média de volume (mL)', calculados.map((calc) => calc.volume || ''), 2, calculados.map((calc) => calc.volumeFora ? 'alert' : 'ok')),
    `<tr>${texto('Situação', 'row-label')}${calculados.map((calc) => texto(calc.volumeFora ? 'Fora da faixa' : 'Conforme', `status ${calc.volumeFora ? 'alert' : 'ok'}`)).join('')}</tr>`,
  ].join('');
  const larguras = `<col style="width:190px">${cols.map(() => '<col style="width:125px">').join('')}`;
  const html = `<!doctype html>
  <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8">
      <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Controle de Densidade</x:Name><x:WorksheetOptions><x:Selected/><x:FreezePanes/><x:FrozenNoSplit/><x:SplitHorizontal>1</x:SplitHorizontal><x:TopRowBottomPane>1</x:TopRowBottomPane></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
      <style>
        body { font-family: Calibri, Arial, sans-serif; color: #172033; }
        table { border-collapse: collapse; margin-bottom: 18px; }
        td, th { padding: 7px 9px; border: 1px solid #d9e0e8; vertical-align: middle; }
        .title { padding: 14px; background: #c2410c; color: #fff; font-size: 18pt; font-weight: 700; text-align: left; }
        .subtitle { padding: 7px 14px; background: #fff7ed; color: #9a3412; font-size: 10pt; text-align: left; }
        .section { padding: 8px 10px; background: #172033; color: #fff; font-size: 11pt; font-weight: 700; text-align: left; }
        .label, .row-label { background: #f1f5f9; color: #344054; font-weight: 700; text-align: left; }
        .value { background: #fff; }
        th { background: #ea580c; color: #fff; font-weight: 700; text-align: center; }
        .text { mso-number-format: "\\@"; }
        .number { text-align: right; }
        .n2 { mso-number-format: "0.00"; }
        .n4 { mso-number-format: "0.0000"; }
        .alert { background: #fee4e2; color: #b42318; font-weight: 700; }
        .ok { background: #ecfdf3; color: #067647; font-weight: 700; }
        .status { text-align: center; font-weight: 700; }
        .footer { color: #667085; font-size: 9pt; border: 0; padding-top: 12px; }
      </style>
    </head>
    <body>
      <table>
        <tr><td class="title" colspan="${totalColunas}">Controle de Densidade — Volume pela Densidade</td></tr>
        <tr><td class="subtitle" colspan="${totalColunas}">Relatório de controle do processo · Sobral</td></tr>
      </table>
      <table>
        <tr><td class="section" colspan="4">Identificação do processo</td></tr>
        ${linhasParametros}
      </table>
      <table>
        ${larguras}
        <tr><td class="section" colspan="${Math.max(cols.length + 1, 1)}">Verificações realizadas</td></tr>
        ${cabecalhoVerificacoes}
        ${linhaTexto('Realizado por', cols.map((col) => col.realizadoPor))}
        ${linhaTexto('Data', cols.map((col) => col.data))}
        ${linhaTexto('Hora', cols.map((col) => col.hora))}
        ${pesos}
        ${volumes}
        ${resumo}
      </table>
      <table><tr><td class="footer">Exportado em ${h(new Date().toLocaleString('pt-BR'))} por ${h(state.usuario?.nomeExibicao || state.usuario?.nome || '')}</td></tr></table>
    </body>
  </html>`;
  baixar(nomeArquivoExportacao('xls'), `\ufeff${html}`, 'application/vnd.ms-excel;charset=utf-8');
}

function render() {
  if (!state.usuario) return lockView();
  if (state.usuario.deveTrocarSenha) return passwordChangeView();
  if (!state.controle) return app.innerHTML = '<main class="loading">Carregando controle...</main>';
  return controleView();
}

(async function init() {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    localStorage.removeItem('selectedUserId');
    localStorage.removeItem('digitalSelecionada');
    const session = await api('/api/me');
    state.usuario = session.usuario;
    agendarSuspensao(session.sessaoExpiraEm);
    if (!state.usuario.deveTrocarSenha) {
      await carregarControle();
      await carregarUsuarios();
    }
    render();
  } catch (err) {
    if (err.status !== 401) state.lockStatus = err.message;
    else limparSessao('Identifique-se para acessar o controle.');
    render();
  }
}());

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.usuario && state.sessionExpiresAt <= Date.now()) suspenderSessao();
});
