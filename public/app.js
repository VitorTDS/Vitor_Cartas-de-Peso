const state = {
  token: localStorage.getItem('token'),
  usuario: JSON.parse(localStorage.getItem('usuario') || 'null'),
  view: 'dashboard',
  data: { produtos: [], embalagens: [], maquinas: [], cartas: [], auditoria: [], usuarios: [], logsAcesso: [], assinaturas: [] },
  lockUsers: [],
  selectedUserId: Number(localStorage.getItem('selectedUserId') || 0),
  cartaAtual: null,
  toast: '',
  lockStatus: 'Aguardando identificação...',
  biometricResult: '',
  bloqueioAutomaticoMinutos: localStorage.getItem('bloqueioAutomaticoMinutos') || '15',
  inactivityTimer: null,
};

const app = document.querySelector('#app');
const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const moeda = (v) => fmt.format(Number(v || 0));
const hoje = () => new Date().toISOString().slice(0, 10);
const horaAgora = () => new Date().toTimeString().slice(0, 5);
const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const perfilLabel = {
  administrador: 'Administrador',
  producao: 'Produção',
  qualidade: 'Qualidade',
  supervisor: 'Supervisor',
  consulta_auditoria: 'Consulta/Auditoria',
};

function pode(perfis) {
  if (!state.usuario) return false;
  if (state.usuario.perfil === 'administrador') return true;
  if (perfis.includes(state.usuario.perfil)) return true;
  return state.usuario.perfil === 'supervisor' && (perfis.includes('producao') || perfis.includes('qualidade'));
}

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
  if (!res.ok) throw new Error(body.error?.message || 'Não conseguimos concluir a operação.');
  return body;
}

async function carregarLock() {
  const [users, config] = await Promise.all([
    api('/api/lock/users'),
    api('/api/configuracoes/bloqueio').catch(() => ({ bloqueioAutomaticoMinutos: '15' })),
  ]);
  state.lockUsers = users.data;
  state.bloqueioAutomaticoMinutos = config.bloqueioAutomaticoMinutos || '15';
  localStorage.setItem('bloqueioAutomaticoMinutos', state.bloqueioAutomaticoMinutos);
  if (!state.selectedUserId && state.lockUsers[0]) state.selectedUserId = state.lockUsers[0].id;
}

async function carregarBase() {
  if (!state.token) return;
  const base = await Promise.all([
    api('/api/produtos'),
    api('/api/embalagens'),
    api('/api/maquinas-balancas'),
    api('/api/cartas'),
  ]);
  state.data.produtos = base[0].data;
  state.data.embalagens = base[1].data;
  state.data.maquinas = base[2].data;
  state.data.cartas = base[3].data;
  if (pode(['administrador', 'qualidade', 'consulta_auditoria'])) {
    const extra = await Promise.all([
      api('/api/auditoria').catch(() => ({ data: [] })),
      api('/api/logs-acesso').catch(() => ({ data: [] })),
      api('/api/assinaturas-eletronicas').catch(() => ({ data: [] })),
    ]);
    state.data.auditoria = extra[0].data;
    state.data.logsAcesso = extra[1].data;
    state.data.assinaturas = extra[2].data;
  }
  if (pode(['administrador'])) {
    state.data.usuarios = (await api('/api/usuarios').catch(() => ({ data: [] }))).data;
  }
}

function setToast(msg) {
  state.toast = msg;
  render();
  setTimeout(() => {
    state.toast = '';
    render();
  }, 3500);
}

function statusBadge(status) {
  const bad = ['reprovado', 'inativo', 'falha'].includes(status);
  const warn = ['aprovado_com_ressalva', 'necessita_avaliacao'].includes(status);
  return `<span class="badge ${bad ? 'bad' : warn ? 'warn' : 'ok'}">${h(String(status || '').replaceAll('_', ' '))}</span>`;
}

function avatar(usuario, grande = false) {
  if (usuario?.avatarUrl) return `<img class="${grande ? 'avatar big' : 'avatar'}" src="${h(usuario.avatarUrl)}" alt="Avatar de ${h(usuario.nome)}">`;
  const initials = (usuario?.nomeExibicao || usuario?.nome || '?').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return `<div class="${grande ? 'avatar big' : 'avatar'}" aria-hidden="true">${h(initials)}</div>`;
}

function lockSession(message = 'Sistema bloqueado. Identifique-se para continuar.') {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  state.token = null;
  state.usuario = null;
  state.lockStatus = message;
  state.biometricResult = '';
  clearTimeout(state.inactivityTimer);
  carregarLock().finally(render);
}

function resetInactivity() {
  clearTimeout(state.inactivityTimer);
  if (!state.token || state.bloqueioAutomaticoMinutos === 'nunca') return;
  state.inactivityTimer = setTimeout(() => lockSession('Bloqueio automático por inatividade.'), Number(state.bloqueioAutomaticoMinutos) * 60 * 1000);
}

['click', 'keydown', 'mousemove', 'touchstart'].forEach((eventName) => {
  document.addEventListener(eventName, resetInactivity, { passive: true });
});

function lockView() {
  const selected = state.lockUsers.find((u) => u.id === state.selectedUserId) || state.lockUsers[0];
  const now = new Date();
  app.innerHTML = `
    <section class="lock-screen">
      <aside class="lock-users" aria-label="Usuários cadastrados">
        <div class="lock-brand">
          <span class="lock-mark">S</span>
          <div><strong>Sistema de Carta de Peso</strong><small>Sobral</small></div>
        </div>
        <p class="lock-label">Usuários</p>
        <div class="lock-user-list">
          ${state.lockUsers.map((u) => `
            <button class="lock-user ${selected?.id === u.id ? 'active' : ''}" data-lock-user="${u.id}">
              ${avatar(u)}<span><strong>${h(u.nomeExibicao || u.nome)}</strong><small>${h(u.setor || perfilLabel[u.perfil])}</small></span>
            </button>
          `).join('')}
        </div>
      </aside>
      <section class="lock-main">
        <div class="lock-clock">
          <strong>${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
          <span>${now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</span>
        </div>
        ${selected ? `
          <div class="lock-card">
            ${avatar(selected, true)}
            <h1>${h(selected.nome)}</h1>
            <p>${h(selected.setor || 'Setor não informado')} · ${h(perfilLabel[selected.perfil] || selected.perfil)}</p>
            <p class="hint">${h(selected.cargo || '')}</p>
            <div class="biometric-status ${state.biometricResult === 'invalid' ? 'bad' : state.biometricResult === 'recognized' ? 'ok' : ''}">
              ${h(state.lockStatus || 'Aguardando digital...')}
            </div>
            <form id="lockForm">
              <input type="hidden" name="usuarioId" value="${selected.id}">
              <label for="pin">Entrar com PIN ou senha alternativa
                <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN ou senha">
              </label>
              <div class="actions center">
                <button type="submit">Entrar</button>
                <button class="secondary" type="button" id="bioOk">Simular digital reconhecida</button>
                <button class="secondary" type="button" id="bioBad">Simular digital inválida</button>
                <button class="secondary" type="button" id="keyboardBtn">Teclado virtual</button>
              </div>
            </form>
          </div>
        ` : '<div class="lock-card"><h1>Nenhum usuário ativo</h1></div>'}
      </section>
    </section>
  `;
  document.querySelectorAll('[data-lock-user]').forEach((btn) => btn.addEventListener('click', () => {
    state.selectedUserId = Number(btn.dataset.lockUser);
    localStorage.setItem('selectedUserId', String(state.selectedUserId));
    state.lockStatus = 'Aguardando digital...';
    state.biometricResult = '';
    render();
  }));
  document.querySelector('#lockForm')?.addEventListener('submit', authPin);
  document.querySelector('#bioOk')?.addEventListener('click', () => authBiometria('recognized'));
  document.querySelector('#bioBad')?.addEventListener('click', () => authBiometria('invalid'));
  document.querySelector('#keyboardBtn')?.addEventListener('click', () => {
    state.lockStatus = 'Use o teclado do Windows pelo ícone de acessibilidade do sistema.';
    render();
  });
}

async function authPin(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const body = await api('/api/lock/auth', { method: 'POST', body: JSON.stringify({ ...payload, metodo: 'pin' }) });
    await entrar(body);
  } catch (err) {
    state.lockStatus = err.message;
    state.biometricResult = 'invalid';
    render();
  }
}

async function authBiometria(result) {
  const selected = state.lockUsers.find((u) => u.id === state.selectedUserId);
  if (!selected) return;
  state.lockStatus = result === 'recognized' ? 'Lendo digital...' : 'Digital inválida simulada.';
  state.biometricResult = result;
  render();
  try {
    const body = await api('/api/lock/auth', {
      method: 'POST',
      body: JSON.stringify({ usuarioId: selected.id, metodo: 'digital', biometricResult: result }),
    });
    await entrar(body);
  } catch (err) {
    state.lockStatus = err.message;
    state.biometricResult = 'invalid';
    render();
  }
}

async function entrar(body) {
  state.token = body.token;
  state.usuario = body.usuario;
  localStorage.setItem('token', body.token);
  localStorage.setItem('usuario', JSON.stringify(body.usuario));
  state.view = 'dashboard';
  state.lockStatus = 'Acesso liberado.';
  await carregarBase();
  resetInactivity();
  render();
}

function shell(content, titulo) {
  const nav = [
    ['dashboard', 'Painel', ['producao', 'qualidade', 'supervisor', 'consulta_auditoria']],
    ['produtos', 'Produtos', ['administrador', 'consulta_auditoria']],
    ['embalagens', 'Embalagens', ['administrador', 'consulta_auditoria']],
    ['maquinas', 'Máquinas e balanças', ['administrador', 'consulta_auditoria']],
    ['cartas', 'Cartas de peso', ['producao', 'qualidade', 'supervisor', 'consulta_auditoria']],
    ['historico', 'Histórico', ['producao', 'qualidade', 'supervisor', 'consulta_auditoria']],
    ['auditoria', 'Auditoria', ['administrador', 'qualidade', 'consulta_auditoria']],
    ['usuarios', 'Usuários', ['administrador']],
  ].filter((item) => pode(item[2]));

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="mark">S</div><div><h1>Cartas de Peso</h1><small>Sobral</small></div></div>
        <nav class="nav" aria-label="Navegação principal">
          ${nav.map(([key, label]) => `<button class="${state.view === key ? 'active' : ''}" data-view="${key}">${label}</button>`).join('')}
        </nav>
      </aside>
      <section class="main">
        <header class="topbar">
          <h2>${h(titulo)}</h2>
          <div class="userbox">
            <strong>${h(state.usuario.nomeExibicao || state.usuario.nome)}</strong><br>
            <span>${h(perfilLabel[state.usuario.perfil] || state.usuario.perfil)}</span>
            <button class="secondary" id="lockBtn" type="button">Bloquear sistema</button>
          </div>
        </header>
        ${state.toast ? `<div class="toast">${h(state.toast)}</div>` : ''}
        ${content}
      </section>
    </div>
  `;
  document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', async () => {
    state.view = btn.dataset.view;
    state.cartaAtual = null;
    await carregarBase();
    render();
  }));
  document.querySelector('#lockBtn').addEventListener('click', () => lockSession('Sistema bloqueado manualmente.'));
}

function dashboard() {
  const abertas = state.data.cartas.filter((c) => c.status === 'aberta').length;
  shell(`
    <section class="stats">
      <div class="stat">Produtos ativos<strong>${state.data.produtos.filter((p) => p.status === 'ativo').length}</strong></div>
      <div class="stat">Cartas abertas<strong>${abertas}</strong></div>
      <div class="stat">Cartas concluídas<strong>${state.data.cartas.length - abertas}</strong></div>
      <div class="stat">Bloqueio automático<strong>${h(state.bloqueioAutomaticoMinutos)} min</strong></div>
    </section>
    <section class="panel" style="margin-top:1rem"><h3>Cartas recentes</h3>${tabelaCartas(state.data.cartas.slice(0, 8))}</section>
  `, 'Painel operacional');
  bindCartaButtons();
}

function produtosView() {
  shell(`
    ${pode(['administrador']) ? formProduto() : ''}
    <section class="panel"><h3>Produtos cadastrados</h3>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Produto</th><th>Volume</th><th>Densidade</th><th>Limites volume</th><th>Limites peso bruto</th><th>Status</th></tr></thead>
    <tbody>${state.data.produtos.map((p) => `<tr><td>${h(p.codigo)}</td><td>${h(p.nome)}</td><td>${moeda(p.volumeDeclaradoMl)} mL</td><td>${h(p.densidadePadrao)}</td><td>${moeda(p.volumeMinimoMl)} - ${moeda(p.volumeMaximoMl)} mL</td><td>${moeda(p.pesoBrutoMinimoG)} - ${moeda(p.pesoBrutoMaximoG)} g</td><td>${statusBadge(p.status)}</td></tr>`).join('')}</tbody></table></div>
    </section>
  `, 'Cadastro de produtos');
  bindProdutoForm();
}

function formProduto() {
  return `<section class="panel"><h3>Novo produto</h3><form id="produtoForm">
    <div class="form-grid">
      <label>Código<input name="codigo" required></label><label>Nome<input name="nome" required></label>
      <label>Volume declarado mL<input name="volumeDeclaradoMl" type="number" step="0.001" required></label><label>Densidade g/mL<input name="densidadePadrao" type="number" step="0.0001" required></label>
      <label>Variação %<input name="variacaoPercentual" type="number" step="0.01" required></label><label>Volume mínimo<input name="volumeMinimoMl" type="number" step="0.001" required></label>
      <label>Volume máximo<input name="volumeMaximoMl" type="number" step="0.001" required></label><label>Peso bruto mínimo<input name="pesoBrutoMinimoG" type="number" step="0.001" required></label>
      <label>Peso bruto máximo<input name="pesoBrutoMaximoG" type="number" step="0.001" required></label><label>Tipo embalagem<input name="tipoEmbalagem" required></label>
      <label>Amostras por coleta<input name="quantidadeAmostras" type="number" min="1" max="20" value="10" required></label><label>Status<select name="status"><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
    </div><button type="submit">Salvar produto</button></form></section>`;
}

function bindProdutoForm() {
  document.querySelector('#produtoForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/api/produtos', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    await carregarBase();
    setToast('Produto cadastrado.');
  });
}

function simplesCadastro(view, titulo, formHtml, endpoint, tabelaHtml) {
  shell(`
    ${pode(['administrador']) ? `<section class="panel"><h3>Novo registro</h3><form id="simpleForm">${formHtml}<button type="submit">Salvar</button></form></section>` : ''}
    <section class="panel"><h3>Registros</h3>${tabelaHtml}</section>
  `, titulo);
  document.querySelector('#simpleForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api(endpoint, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    await carregarBase();
    state.view = view;
    setToast('Registro salvo.');
  });
}

function embalagensView() {
  simplesCadastro('embalagens', 'Cadastro de embalagens', `
    <div class="form-grid"><label>Código<input name="codigo" required></label><label>Descrição<input name="descricao" required></label>
    <label>Tipo<select name="tipo"><option>frasco</option><option>tampa</option><option>lacre</option><option>conjunto completo</option></select></label>
    <label>Peso médio g<input name="pesoMedioG" type="number" step="0.001" required></label><label>Unidade<input name="unidade" value="g" required></label><label>Observações<input name="observacoes"></label></div>`,
    '/api/embalagens',
    `<div class="table-wrap"><table><thead><tr><th>Código</th><th>Descrição</th><th>Tipo</th><th>Peso médio</th><th>Observações</th></tr></thead><tbody>
    ${state.data.embalagens.map((e) => `<tr><td>${h(e.codigo)}</td><td>${h(e.descricao)}</td><td>${h(e.tipo)}</td><td>${moeda(e.peso_medio_g)} ${h(e.unidade)}</td><td>${h(e.observacoes || '')}</td></tr>`).join('') || '<tr><td colspan="5">Nenhuma embalagem cadastrada.</td></tr>'}
    </tbody></table></div>`);
}

function maquinasView() {
  simplesCadastro('maquinas', 'Máquinas e balanças', `
    <div class="form-grid"><label>Linha<input name="linha" required></label><label>Máquina envase<input name="maquinaEnvase" required></label>
    <label>TAG máquina<input name="tagMaquina" required></label><label>Balança<input name="balanca" required></label><label>TAG balança<input name="tagBalanca" required></label>
    <label>Status<select name="status"><option>ativo</option><option>inativo</option></select></label><label>Observações<input name="observacoes"></label></div>`,
    '/api/maquinas-balancas',
    `<div class="table-wrap"><table><thead><tr><th>Linha</th><th>Máquina</th><th>TAG</th><th>Balança</th><th>Status</th></tr></thead><tbody>
    ${state.data.maquinas.map((m) => `<tr><td>${h(m.linha)}</td><td>${h(m.maquina_envase)}</td><td>${h(m.tag_maquina)}</td><td>${h(m.balanca)} / ${h(m.tag_balanca)}</td><td>${statusBadge(m.status)}</td></tr>`).join('')}
    </tbody></table></div>`);
}

function cartasView() {
  shell(`
    ${pode(['producao']) ? formCarta() : ''}
    <section class="panel"><h3>Cartas de peso</h3>${tabelaCartas(state.data.cartas)}</section>
  `, 'Cartas de peso');
  bindCartaForm();
  bindCartaButtons();
}

function formCarta() {
  return `<section class="panel"><h3>Abrir nova carta</h3><form id="cartaForm">
    <div class="form-grid">
      <label>Produto<select name="produtoId" required>${state.data.produtos.map((p) => `<option value="${p.id}">${h(p.codigo)} - ${h(p.nome)}</option>`).join('')}</select></label>
      <label>Lote<input name="lote" required></label><label>Ordem produção<input name="ordemProducao"></label>
      <label>Máquina/Balança<select name="maquinaBalancaId">${state.data.maquinas.map((m) => `<option value="${m.id}">${h(m.linha)} - ${h(m.maquina_envase)} / ${h(m.balanca)}</option>`).join('')}</select></label>
      <label>Frequência min<input name="frequenciaMinutos" type="number" value="30" required></label><label>Tolerância min<input name="toleranciaMinutos" type="number" value="10" required></label>
      <label>Responsável<input name="responsavelAbertura" value="${h(state.usuario.nome)}" required></label><label>Data abertura<input name="dataAbertura" type="datetime-local" value="${new Date().toISOString().slice(0, 16)}" required></label>
    </div><textarea name="observacoes" placeholder="Observações"></textarea><button type="submit">Abrir carta</button>
  </form></section>`;
}

function bindCartaForm() {
  document.querySelector('#cartaForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const produto = state.data.produtos.find((p) => String(p.id) === String(data.produtoId));
    Object.assign(data, {
      volumeDeclaradoMl: produto.volumeDeclaradoMl,
      densidade: produto.densidadePadrao,
      variacaoPercentual: produto.variacaoPercentual,
      volumeMinimoMl: produto.volumeMinimoMl,
      volumeMaximoMl: produto.volumeMaximoMl,
      pesoBrutoMinimoG: produto.pesoBrutoMinimoG,
      pesoBrutoMaximoG: produto.pesoBrutoMaximoG,
      quantidadeAmostras: produto.quantidadeAmostras,
    });
    const carta = await api('/api/cartas', { method: 'POST', body: JSON.stringify(data) });
    state.cartaAtual = { carta, coletas: [], resumo: {} };
    state.view = 'detalheCarta';
    await carregarBase();
    render();
  });
}

function tabelaCartas(cartas) {
  return `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Produto</th><th>Lote</th><th>Abertura</th><th>Máquina</th><th>Status</th><th>Ações</th></tr></thead><tbody>
    ${cartas.map((c) => `<tr><td>${c.id}</td><td>${h(c.produtoNome)}</td><td>${h(c.lote)}</td><td>${new Date(c.dataAbertura).toLocaleString('pt-BR')}</td><td>${h(c.maquinaEnvase || '')} ${h(c.balanca || '')}</td><td>${statusBadge(c.status)}</td><td><button class="secondary" data-carta="${c.id}">Abrir</button></td></tr>`).join('') || '<tr><td colspan="7">Nenhuma carta encontrada.</td></tr>'}
  </tbody></table></div>`;
}

function bindCartaButtons() {
  document.querySelectorAll('[data-carta]').forEach((btn) => btn.addEventListener('click', async () => {
    state.cartaAtual = await api(`/api/cartas/${btn.dataset.carta}`);
    state.view = 'detalheCarta';
    render();
  }));
}

function detalheCartaView() {
  const { carta, coletas, resumo } = state.cartaAtual;
  shell(`
    <section class="grid two">
      <div class="panel"><h3>${h(carta.produtoNome)} - lote ${h(carta.lote)}</h3>
        <p><strong>Densidade:</strong> ${h(carta.densidade)} g/mL | <strong>Volume:</strong> ${moeda(carta.volumeDeclaradoMl)} mL</p>
        <p><strong>Limites:</strong> ${moeda(carta.volumeMinimoMl)} a ${moeda(carta.volumeMaximoMl)} mL | ${moeda(carta.pesoBrutoMinimoG)} a ${moeda(carta.pesoBrutoMaximoG)} g</p>
        <p><strong>Frequência:</strong> ${carta.frequenciaMinutos} min com tolerância de ${carta.toleranciaMinutos} min</p><p><strong>Status:</strong> ${statusBadge(carta.status)}</p>
      </div>
      <div class="panel"><h3>Resumo</h3><p>Total de coletas: <strong>${resumo.totalColetas || 0}</strong></p>
        <p>Amostras: <strong>${resumo.totalAmostras || 0}</strong> | Fora do limite: <strong>${resumo.amostrasForaLimite || 0}</strong></p>
        <p>Volume médio geral: <strong>${moeda(resumo.volumeMedioGeral)} mL</strong></p>
        <div class="actions"><button class="secondary" id="relatorioBtn">Relatório/PDF</button>${pode(['qualidade']) && carta.status === 'aberta' ? '<button id="fecharBtn">Fechar carta</button>' : ''}</div>
      </div>
    </section>
    <section class="panel"><h3>Gráfico do volume médio</h3><canvas id="chart" class="chart" width="900" height="310" aria-label="Gráfico de volume médio por coleta"></canvas></section>
    ${carta.status === 'aberta' && pode(['producao']) ? formColeta(carta, coletas.length + 1) : ''}
    <section class="panel"><h3>Coletas registradas</h3>${tabelaColetas(coletas)}</section>
    <section class="panel" id="fechamentoPanel" hidden><h3>Fechamento com assinatura eletrônica</h3>${formFechamento(resumo)}</section>
  `, 'Detalhe da carta');
  desenharGrafico(carta, coletas);
  bindColetaForm(carta);
  document.querySelector('#relatorioBtn').addEventListener('click', relatorioView);
  document.querySelector('#fecharBtn')?.addEventListener('click', () => document.querySelector('#fechamentoPanel').hidden = false);
  bindFechamento(carta);
}

function formColeta(carta, numero) {
  return `<section class="panel"><h3>Registrar coleta</h3><form id="coletaForm">
    <div class="form-grid"><label>Número<input name="numeroColeta" type="number" value="${numero}" required></label><label>Responsável<input name="responsavel" value="${h(state.usuario.nome)}" required></label>
      <label>Data<input name="data" type="date" value="${hoje()}" required></label><label>Hora<input name="hora" type="time" value="${horaAgora()}" required></label><label>Tara embalagem g<input id="tara" name="taraEmbalagemG" type="number" step="0.001" required></label></div>
    <div class="samples">${Array.from({ length: carta.quantidadeAmostras }, (_, i) => `<label>Peso bruto ${i + 1}<input class="peso" name="peso${i}" type="number" step="0.001"></label>`).join('')}</div>
    <div id="preview" class="hint"></div><button type="submit">Salvar coleta</button>
  </form></section>`;
}

function calcularPreview(carta) {
  const tara = Number(document.querySelector('#tara')?.value || 0);
  const pesos = [...document.querySelectorAll('.peso')].map((i) => Number(i.value)).filter(Boolean);
  const volumes = pesos.map((p) => (p - tara) / carta.densidade);
  const fora = volumes.filter((v) => v < carta.volumeMinimoMl || v > carta.volumeMaximoMl).length;
  const media = volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
  document.querySelector('#preview').innerHTML = volumes.length ? `Prévia: média ${moeda(media)} mL, ${fora} amostra(s) fora do limite.` : '';
}

function bindColetaForm(carta) {
  const form = document.querySelector('#coletaForm');
  if (!form) return;
  form.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => calcularPreview(carta)));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form));
    payload.pesosBrutos = [...form.querySelectorAll('.peso')].map((i) => i.value).filter(Boolean);
    await api(`/api/cartas/${carta.id}/coletas`, { method: 'POST', body: JSON.stringify(payload) });
    state.cartaAtual = await api(`/api/cartas/${carta.id}`);
    setToast('Coleta registrada.');
  });
}

function tabelaColetas(coletas) {
  return `<div class="table-wrap"><table><thead><tr><th>Coleta</th><th>Responsável</th><th>Data/Hora</th><th>Tara</th><th>Média bruto</th><th>Média volume</th><th>Menor/Maior</th><th>Status</th></tr></thead><tbody>
    ${coletas.map((c) => `<tr><td>${c.numeroColeta}</td><td>${h(c.responsavel)}</td><td>${h(c.data)} ${h(c.hora)}</td><td>${moeda(c.taraEmbalagemG)} g</td><td>${moeda(c.resultado.mediaPesosBrutos)} g</td><td class="${c.status === 'reprovado' ? 'bad-cell' : ''}">${moeda(c.resultado.mediaVolumes)} mL</td><td>${moeda(c.resultado.menorVolume)} / ${moeda(c.resultado.maiorVolume)} mL</td><td>${statusBadge(c.status)}</td></tr>`).join('') || '<tr><td colspan="8">Nenhuma coleta registrada.</td></tr>'}
  </tbody></table></div>`;
}

function desenharGrafico(carta, coletas) {
  const canvas = document.querySelector('#chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const pad = 42;
  const valores = coletas.map((c) => c.resultado.mediaVolumes);
  const min = Math.min(carta.volumeMinimoMl - 1, ...valores);
  const max = Math.max(carta.volumeMaximoMl + 1, ...valores);
  const y = (v) => canvas.height - pad - ((v - min) / (max - min || 1)) * (canvas.height - pad * 2);
  const x = (i) => pad + (i * (canvas.width - pad * 2)) / Math.max(1, valores.length - 1);
  ctx.strokeStyle = '#d8e0dc'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, canvas.height - pad); ctx.lineTo(canvas.width - pad, canvas.height - pad); ctx.stroke();
  [['Mínimo', carta.volumeMinimoMl], ['Máximo', carta.volumeMaximoMl]].forEach(([label, val]) => {
    ctx.strokeStyle = '#9a6700'; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(pad, y(val)); ctx.lineTo(canvas.width - pad, y(val)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#9a6700'; ctx.fillText(`${label} ${moeda(val)}`, pad + 6, y(val) - 6);
  });
  ctx.strokeStyle = '#0f6b57'; ctx.lineWidth = 2; ctx.beginPath();
  valores.forEach((v, i) => { if (i === 0) ctx.moveTo(x(i), y(v)); else ctx.lineTo(x(i), y(v)); });
  ctx.stroke();
  valores.forEach((v, i) => {
    ctx.fillStyle = v < carta.volumeMinimoMl || v > carta.volumeMaximoMl ? '#b42318' : '#087443';
    ctx.beginPath(); ctx.arc(x(i), y(v), 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(String(i + 1), x(i) - 3, canvas.height - 18);
  });
}

function formFechamento(resumo) {
  return `<form id="fechamentoForm">
    <p>Status sugerido: ${statusBadge(resumo.statusFinalSugerido || 'aprovado')}</p>
    <div class="form-grid">
      <label>Status final<select name="statusFinal"><option value="aprovado">Aprovado</option><option value="aprovado_com_ressalva">Aprovado com ressalva</option><option value="reprovado">Reprovado</option></select></label>
      <label>Conferido por<input name="conferidoPor" value="${h(state.usuario.nome)}" required></label>
      <label>Método<select name="metodoAssinatura" id="metodoAssinatura"><option value="pin">PIN/senha</option><option value="digital">Digital simulada</option></select></label>
      <label>PIN/senha<input name="pin" type="password" autocomplete="current-password"></label>
    </div>
    <input type="hidden" name="biometricResult" id="signatureBioResult" value="">
    <div class="actions"><button type="button" class="secondary" id="sigBioOk">Simular digital reconhecida</button><button type="button" class="secondary" id="sigBioBad">Simular digital inválida</button></div>
    <label>Justificativa / observação<textarea name="justificativa"></textarea></label>
    <button type="submit">Finalizar carta com assinatura</button>
  </form>`;
}

function bindFechamento(carta) {
  const form = document.querySelector('#fechamentoForm');
  if (!form) return;
  document.querySelector('#sigBioOk').addEventListener('click', () => { document.querySelector('#metodoAssinatura').value = 'digital'; document.querySelector('#signatureBioResult').value = 'recognized'; setToast('Digital simulada reconhecida para assinatura.'); });
  document.querySelector('#sigBioBad').addEventListener('click', () => { document.querySelector('#metodoAssinatura').value = 'digital'; document.querySelector('#signatureBioResult').value = 'invalid'; setToast('Digital simulada inválida para assinatura.'); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.cartaAtual = await api(`/api/cartas/${carta.id}/fechamento`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    await carregarBase();
    setToast('Carta finalizada com assinatura eletrônica.');
  });
}

async function relatorioView() {
  const { carta, coletas, resumo, impressoPor, impressoEm } = await api(`/api/cartas/${state.cartaAtual.carta.id}/relatorio`);
  shell(`<article class="report">
    <div class="report-header"><div><h1>Sobral - Carta de Peso</h1><p>Relatório de controle de envase por densidade</p></div><div><strong>Impresso por:</strong> ${h(impressoPor)}<br><strong>Data:</strong> ${new Date(impressoEm).toLocaleString('pt-BR')}</div></div>
    <section class="grid two"><div><strong>Produto:</strong> ${h(carta.produtoNome)}<br><strong>Lote:</strong> ${h(carta.lote)}<br><strong>Volume declarado:</strong> ${moeda(carta.volumeDeclaradoMl)} mL<br><strong>Densidade:</strong> ${h(carta.densidade)} g/mL</div>
    <div><strong>Limites volume:</strong> ${moeda(carta.volumeMinimoMl)} a ${moeda(carta.volumeMaximoMl)} mL<br><strong>Máquina:</strong> ${h(carta.maquinaEnvase)}<br><strong>Linha:</strong> ${h(carta.linha)}<br><strong>Balança:</strong> ${h(carta.balanca)}</div></section>
    ${tabelaColetas(coletas)}
    <p><strong>Volume médio geral:</strong> ${moeda(resumo.volumeMedioGeral)} mL | <strong>Menor:</strong> ${moeda(resumo.menorVolume)} mL | <strong>Maior:</strong> ${moeda(resumo.maiorVolume)} mL</p>
    <p><strong>Amostras aprovadas:</strong> ${resumo.amostrasAprovadas} | <strong>Fora do limite:</strong> ${resumo.amostrasForaLimite} | <strong>Status:</strong> ${h(resumo.statusFinalSugerido)}</p>
    <p><strong>Conferido por:</strong> ${h(carta.conferidoPor || '________________________')} &nbsp; <strong>Assinatura:</strong> ${h(carta.assinaturaResponsavel || '________________________')}</p>
    <div class="actions no-print"><button onclick="window.print()">Gerar PDF / Imprimir</button><button class="secondary" id="voltarRel">Voltar</button></div>
  </article>`, 'Relatório');
  document.querySelector('#voltarRel').addEventListener('click', () => { state.view = 'detalheCarta'; render(); });
}

function historicoView() {
  shell(`<section class="panel"><h3>Histórico de cartas</h3>
    <div class="form-grid no-print"><label>Produto<input id="fProduto" placeholder="Filtrar produto"></label><label>Lote<input id="fLote" placeholder="Filtrar lote"></label><label>Status<select id="fStatus"><option value="">Todos</option><option value="aberta">Aberta</option><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option></select></label></div>
    <div id="historicoTabela">${tabelaCartas(state.data.cartas)}</div></section>`, 'Histórico e rastreabilidade');
  ['fProduto', 'fLote', 'fStatus'].forEach((id) => document.querySelector(`#${id}`).addEventListener('input', filtrarHistorico));
  bindCartaButtons();
}

function filtrarHistorico() {
  const produto = document.querySelector('#fProduto').value.toLowerCase();
  const lote = document.querySelector('#fLote').value.toLowerCase();
  const status = document.querySelector('#fStatus').value;
  const filtradas = state.data.cartas.filter((c) => c.produtoNome.toLowerCase().includes(produto) && c.lote.toLowerCase().includes(lote) && (!status || c.status === status));
  document.querySelector('#historicoTabela').innerHTML = tabelaCartas(filtradas);
  bindCartaButtons();
}

function auditoriaView() {
  shell(`<section class="grid two">
    <div class="panel"><h3>Logs de acesso</h3>${simpleTable(['Data', 'Usuário', 'Método', 'Status', 'Dispositivo'], state.data.logsAcesso.map((l) => [new Date(l.criado_em).toLocaleString('pt-BR'), l.usuario_nome || '', l.metodo, statusBadge(l.status), l.dispositivo || '']))}</div>
    <div class="panel"><h3>Assinaturas eletrônicas</h3>${simpleTable(['Data', 'Usuário', 'Ação', 'Método', 'Observação'], state.data.assinaturas.map((s) => [new Date(s.criado_em).toLocaleString('pt-BR'), s.usuario_nome, s.acao, s.metodo, s.observacao || '']))}</div>
    <div class="panel" style="grid-column:1/-1"><h3>Auditoria de alterações</h3>${simpleTable(['Data', 'Usuário', 'Entidade', 'Ação'], state.data.auditoria.map((a) => [new Date(a.criado_em).toLocaleString('pt-BR'), a.usuario_nome, `${a.entidade} #${a.entidade_id}`, a.acao]))}</div>
  </section>`, 'Auditoria');
}

function simpleTable(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((x) => `<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell).startsWith('<span') ? cell : h(cell)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}">Nenhum registro encontrado.</td></tr>`}</tbody></table></div>`;
}

function usuariosView() {
  shell(`
    <section class="panel"><h3>Cadastro de usuários</h3>${formUsuario()}<hr>${configBloqueio()}</section>
    <section class="panel"><h3>Usuários cadastrados</h3>${tabelaUsuarios()}</section>
  `, 'Usuários e segurança');
  bindUsuarioForm();
  bindBiometria();
  bindConfigBloqueio();
}

function formUsuario() {
  return `<form id="usuarioForm"><div class="form-grid">
    <label>Nome completo<input name="nome" required></label><label>Nome de exibição<input name="nomeExibicao" required></label><label>Matrícula/código<input name="matricula"></label>
    <label>Setor<input name="setor"></label><label>Cargo<input name="cargo"></label><label>E-mail<input name="email" type="email" required></label>
    <label>Perfil<select name="perfil"><option value="administrador">Administrador</option><option value="producao">Produção</option><option value="qualidade">Qualidade</option><option value="supervisor">Supervisor</option><option value="consulta_auditoria">Consulta/Auditoria</option></select></label>
    <label>Status<select name="status"><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label><label>Foto/avatar URL<input name="avatarUrl"></label>
    <label>PIN ou senha alternativa<input name="senha" type="password" required></label>
  </div><button type="submit">Salvar usuário</button></form>`;
}

function configBloqueio() {
  return `<form id="configBloqueioForm" class="actions"><label>Bloqueio automático<select name="bloqueioAutomaticoMinutos"><option value="5">5 minutos</option><option value="10">10 minutos</option><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="nunca">Nunca</option></select></label><button type="submit">Salvar configuração</button></form>`;
}

function tabelaUsuarios() {
  return `<div class="table-wrap"><table><thead><tr><th>Usuário</th><th>Matrícula</th><th>Setor</th><th>Cargo</th><th>Perfil</th><th>Digital</th><th>Último acesso</th><th>Ações</th></tr></thead><tbody>
    ${state.data.usuarios.map((u) => `<tr><td>${avatar(u)} ${h(u.nome)}<br><span class="hint">${h(u.email)}</span></td><td>${h(u.matricula)}</td><td>${h(u.setor)}</td><td>${h(u.cargo)}</td><td>${h(perfilLabel[u.perfil])}</td><td>${u.digitalCadastrada ? statusBadge('cadastrada') : statusBadge('pendente')}</td><td>${u.ultimoAcesso ? new Date(u.ultimoAcesso).toLocaleString('pt-BR') : ''}</td><td><button class="secondary" data-bio="${u.id}">Cadastrar digital</button></td></tr>`).join('')}
  </tbody></table></div>`;
}

function bindUsuarioForm() {
  document.querySelector('#usuarioForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/api/usuarios', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    await carregarBase();
    setToast('Usuário cadastrado.');
  });
}

function bindBiometria() {
  document.querySelectorAll('[data-bio]').forEach((btn) => btn.addEventListener('click', async () => {
    await api(`/api/usuarios/${btn.dataset.bio}/biometria`, { method: 'POST', body: '{}' });
    await carregarBase();
    await carregarLock();
    setToast('Digital simulada cadastrada para o usuário.');
  }));
}

function bindConfigBloqueio() {
  const form = document.querySelector('#configBloqueioForm');
  if (!form) return;
  form.bloqueioAutomaticoMinutos.value = state.bloqueioAutomaticoMinutos;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = await api('/api/configuracoes/bloqueio', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.bloqueioAutomaticoMinutos = body.bloqueioAutomaticoMinutos;
    localStorage.setItem('bloqueioAutomaticoMinutos', state.bloqueioAutomaticoMinutos);
    resetInactivity();
    setToast('Configuração de bloqueio salva.');
  });
}

function render() {
  if (!state.token) return lockView();
  const views = { dashboard, produtos: produtosView, embalagens: embalagensView, maquinas: maquinasView, cartas: cartasView, detalheCarta: detalheCartaView, historico: historicoView, auditoria: auditoriaView, usuarios: usuariosView };
  return (views[state.view] || dashboard)();
}

(async function init() {
  try {
    await carregarLock();
    if (state.token) {
      await carregarBase();
      resetInactivity();
    }
    render();
  } catch (err) {
    state.lockStatus = err.message;
    lockView();
  }
})();
