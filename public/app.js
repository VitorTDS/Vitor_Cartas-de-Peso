const state = {
  token: localStorage.getItem('token'),
  usuario: JSON.parse(localStorage.getItem('usuario') || 'null'),
  view: 'dashboard',
  data: { produtos: [], embalagens: [], maquinas: [], cartas: [], auditoria: [] },
  cartaAtual: null,
  toast: '',
};

const app = document.querySelector('#app');

const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const hoje = () => new Date().toISOString().slice(0, 10);
const horaAgora = () => new Date().toTimeString().slice(0, 5);
const moeda = (v) => fmt.format(Number(v || 0));

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

function setToast(msg) {
  state.toast = msg;
  render();
  setTimeout(() => {
    state.toast = '';
    render();
  }, 3500);
}

function statusBadge(status) {
  const bad = ['reprovado', 'inativo'].includes(status);
  const warn = ['aprovado_com_ressalva', 'necessita_avaliacao'].includes(status);
  return `<span class="badge ${bad ? 'bad' : warn ? 'warn' : 'ok'}">${String(status || '').replaceAll('_', ' ')}</span>`;
}

function loginView() {
  app.innerHTML = `
    <section class="login">
      <form class="login-card" id="loginForm">
        <div class="brand">
          <div class="mark">S</div>
          <div>
            <h1>Cartas de Peso Sobral</h1>
            <p class="hint">Controle de envase por densidade</p>
          </div>
        </div>
        <label for="email">E-mail
          <input id="email" name="email" type="email" autocomplete="username" value="admin@sobral.local" required>
        </label>
        <label for="senha">Senha
          <input id="senha" name="senha" type="password" autocomplete="current-password" value="admin123" required>
        </label>
        <button type="submit">Entrar</button>
        <p class="hint">Acessos iniciais: admin@sobral.local/admin123, producao@sobral.local/producao123, qualidade@sobral.local/qualidade123.</p>
        <p class="error" id="loginErro"></p>
      </form>
    </section>
  `;
  document.querySelector('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const body = await api('/api/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
      state.token = body.token;
      state.usuario = body.usuario;
      localStorage.setItem('token', body.token);
      localStorage.setItem('usuario', JSON.stringify(body.usuario));
      await carregarBase();
      render();
    } catch (err) {
      document.querySelector('#loginErro').textContent = err.message;
    }
  });
}

function shell(content, titulo) {
  const nav = [
    ['dashboard', 'Painel'],
    ['produtos', 'Produtos'],
    ['embalagens', 'Embalagens'],
    ['maquinas', 'Máquinas e balanças'],
    ['cartas', 'Cartas de peso'],
    ['historico', 'Histórico'],
    ['auditoria', 'Auditoria'],
    ['usuarios', 'Usuários'],
  ].filter(([key]) => state.usuario.perfil === 'administrador' || !['usuarios', 'auditoria'].includes(key));

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
          <h2>${titulo}</h2>
          <div class="userbox">
            <strong>${state.usuario.nome}</strong><br>
            <span>${state.usuario.perfil}</span>
            <button class="secondary" id="logout" type="button">Sair</button>
          </div>
        </header>
        ${state.toast ? `<div class="toast">${state.toast}</div>` : ''}
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
  document.querySelector('#logout').addEventListener('click', () => {
    localStorage.clear();
    state.token = null;
    state.usuario = null;
    loginView();
  });
}

async function carregarBase() {
  if (!state.token) return;
  const [produtos, embalagens, maquinas, cartas] = await Promise.all([
    api('/api/produtos'),
    api('/api/embalagens'),
    api('/api/maquinas-balancas'),
    api('/api/cartas'),
  ]);
  state.data.produtos = produtos.data;
  state.data.embalagens = embalagens.data;
  state.data.maquinas = maquinas.data;
  state.data.cartas = cartas.data;
  if (['administrador', 'qualidade'].includes(state.usuario.perfil)) {
    state.data.auditoria = (await api('/api/auditoria').catch(() => ({ data: [] }))).data;
  }
}

function dashboard() {
  const abertas = state.data.cartas.filter((c) => c.status === 'aberta').length;
  const fechadas = state.data.cartas.length - abertas;
  shell(`
    <section class="stats">
      <div class="stat">Produtos ativos<strong>${state.data.produtos.filter((p) => p.status === 'ativo').length}</strong></div>
      <div class="stat">Cartas abertas<strong>${abertas}</strong></div>
      <div class="stat">Cartas fechadas<strong>${fechadas}</strong></div>
      <div class="stat">Máquinas cadastradas<strong>${state.data.maquinas.length}</strong></div>
    </section>
    <section class="panel" style="margin-top:1rem">
      <h3>Cartas recentes</h3>
      ${tabelaCartas(state.data.cartas.slice(0, 8))}
    </section>
  `, 'Painel operacional');
  bindCartaButtons();
}

function produtosView() {
  const podeEditar = state.usuario.perfil === 'administrador';
  shell(`
    ${podeEditar ? formProduto() : ''}
    <section class="panel">
      <h3>Produtos cadastrados</h3>
      <div class="table-wrap"><table><thead><tr><th>Código</th><th>Produto</th><th>Volume</th><th>Densidade</th><th>Limites volume</th><th>Limites peso bruto</th><th>Status</th></tr></thead>
      <tbody>${state.data.produtos.map((p) => `<tr><td>${p.codigo}</td><td>${p.nome}</td><td>${moeda(p.volumeDeclaradoMl)} mL</td><td>${p.densidadePadrao}</td><td>${moeda(p.volumeMinimoMl)} - ${moeda(p.volumeMaximoMl)} mL</td><td>${moeda(p.pesoBrutoMinimoG)} - ${moeda(p.pesoBrutoMaximoG)} g</td><td>${statusBadge(p.status)}</td></tr>`).join('')}</tbody></table></div>
    </section>
  `, 'Cadastro de produtos');
  bindProdutoForm();
}

function formProduto() {
  return `
    <section class="panel">
      <h3>Novo produto</h3>
      <form id="produtoForm">
        <div class="form-grid">
          <label>Código<input name="codigo" required></label>
          <label>Nome<input name="nome" required></label>
          <label>Volume declarado mL<input name="volumeDeclaradoMl" type="number" step="0.001" required></label>
          <label>Densidade g/mL<input name="densidadePadrao" type="number" step="0.0001" required></label>
          <label>Variação %<input name="variacaoPercentual" type="number" step="0.01" required></label>
          <label>Volume mínimo<input name="volumeMinimoMl" type="number" step="0.001" required></label>
          <label>Volume máximo<input name="volumeMaximoMl" type="number" step="0.001" required></label>
          <label>Peso bruto mínimo<input name="pesoBrutoMinimoG" type="number" step="0.001" required></label>
          <label>Peso bruto máximo<input name="pesoBrutoMaximoG" type="number" step="0.001" required></label>
          <label>Tipo embalagem<input name="tipoEmbalagem" required></label>
          <label>Amostras por coleta<input name="quantidadeAmostras" type="number" min="1" max="20" value="10" required></label>
          <label>Status<select name="status"><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
        </div>
        <button type="submit">Salvar produto</button>
      </form>
    </section>`;
}

function bindProdutoForm() {
  const form = document.querySelector('#produtoForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/api/produtos', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    await carregarBase();
    setToast('Produto cadastrado.');
  });
}

function simplesCadastro(view, titulo, formHtml, endpoint, tabelaHtml) {
  shell(`
    ${state.usuario.perfil === 'administrador' ? `<section class="panel"><h3>Novo registro</h3><form id="simpleForm">${formHtml}<button type="submit">Salvar</button></form></section>` : ''}
    <section class="panel"><h3>Registros</h3>${tabelaHtml}</section>
  `, titulo);
  const form = document.querySelector('#simpleForm');
  if (form) form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api(endpoint, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    await carregarBase();
    state.view = view;
    setToast('Registro salvo.');
  });
}

function embalagensView() {
  simplesCadastro('embalagens', 'Cadastro de embalagens', `
    <div class="form-grid">
      <label>Código<input name="codigo" required></label><label>Descrição<input name="descricao" required></label>
      <label>Tipo<select name="tipo"><option>frasco</option><option>tampa</option><option>lacre</option><option>conjunto completo</option></select></label>
      <label>Peso médio g<input name="pesoMedioG" type="number" step="0.001" required></label>
      <label>Unidade<input name="unidade" value="g" required></label><label>Observações<input name="observacoes"></label>
    </div>`, '/api/embalagens', `
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Descrição</th><th>Tipo</th><th>Peso médio</th><th>Observações</th></tr></thead><tbody>
    ${state.data.embalagens.map((e) => `<tr><td>${e.codigo}</td><td>${e.descricao}</td><td>${e.tipo}</td><td>${moeda(e.peso_medio_g)} ${e.unidade}</td><td>${e.observacoes || ''}</td></tr>`).join('') || '<tr><td colspan="5">Nenhuma embalagem cadastrada.</td></tr>'}
    </tbody></table></div>`);
}

function maquinasView() {
  simplesCadastro('maquinas', 'Máquinas e balanças', `
    <div class="form-grid">
      <label>Linha<input name="linha" required></label><label>Máquina envase<input name="maquinaEnvase" required></label>
      <label>TAG máquina<input name="tagMaquina" required></label><label>Balança<input name="balanca" required></label>
      <label>TAG balança<input name="tagBalanca" required></label><label>Status<select name="status"><option>ativo</option><option>inativo</option></select></label>
      <label>Observações<input name="observacoes"></label>
    </div>`, '/api/maquinas-balancas', `
    <div class="table-wrap"><table><thead><tr><th>Linha</th><th>Máquina</th><th>TAG</th><th>Balança</th><th>Status</th></tr></thead><tbody>
    ${state.data.maquinas.map((m) => `<tr><td>${m.linha}</td><td>${m.maquina_envase}</td><td>${m.tag_maquina}</td><td>${m.balanca} / ${m.tag_balanca}</td><td>${statusBadge(m.status)}</td></tr>`).join('')}
    </tbody></table></div>`);
}

function cartasView() {
  shell(`
    ${['administrador', 'producao'].includes(state.usuario.perfil) ? formCarta() : ''}
    <section class="panel"><h3>Cartas de peso</h3>${tabelaCartas(state.data.cartas)}</section>
  `, 'Cartas de peso');
  bindCartaForm();
  bindCartaButtons();
}

function formCarta() {
  return `<section class="panel"><h3>Abrir nova carta</h3><form id="cartaForm">
    <div class="form-grid">
      <label>Produto<select name="produtoId" id="produtoSelect" required>${state.data.produtos.map((p) => `<option value="${p.id}">${p.codigo} - ${p.nome}</option>`).join('')}</select></label>
      <label>Lote<input name="lote" required></label><label>Ordem produção<input name="ordemProducao"></label>
      <label>Máquina/Balança<select name="maquinaBalancaId">${state.data.maquinas.map((m) => `<option value="${m.id}">${m.linha} - ${m.maquina_envase} / ${m.balanca}</option>`).join('')}</select></label>
      <label>Frequência min<input name="frequenciaMinutos" type="number" value="30" required></label>
      <label>Tolerância min<input name="toleranciaMinutos" type="number" value="10" required></label>
      <label>Responsável<input name="responsavelAbertura" value="${state.usuario.nome}" required></label>
      <label>Data abertura<input name="dataAbertura" type="datetime-local" value="${new Date().toISOString().slice(0, 16)}" required></label>
    </div>
    <textarea name="observacoes" placeholder="Observações"></textarea>
    <button type="submit">Abrir carta</button>
  </form></section>`;
}

function bindCartaForm() {
  const form = document.querySelector('#cartaForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
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
    ${cartas.map((c) => `<tr><td>${c.id}</td><td>${c.produtoNome}</td><td>${c.lote}</td><td>${new Date(c.dataAbertura).toLocaleString('pt-BR')}</td><td>${c.maquinaEnvase || ''} ${c.balanca || ''}</td><td>${statusBadge(c.status)}</td><td><button class="secondary" data-carta="${c.id}">Abrir</button></td></tr>`).join('') || '<tr><td colspan="7">Nenhuma carta encontrada.</td></tr>'}
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
      <div class="panel">
        <h3>${carta.produtoNome} - lote ${carta.lote}</h3>
        <p><strong>Densidade:</strong> ${carta.densidade} g/mL | <strong>Volume:</strong> ${moeda(carta.volumeDeclaradoMl)} mL</p>
        <p><strong>Limites:</strong> ${moeda(carta.volumeMinimoMl)} a ${moeda(carta.volumeMaximoMl)} mL | ${moeda(carta.pesoBrutoMinimoG)} a ${moeda(carta.pesoBrutoMaximoG)} g</p>
        <p><strong>Frequência:</strong> ${carta.frequenciaMinutos} min com tolerância de ${carta.toleranciaMinutos} min</p>
        <p><strong>Status:</strong> ${statusBadge(carta.status)}</p>
      </div>
      <div class="panel">
        <h3>Resumo</h3>
        <p>Total de coletas: <strong>${resumo.totalColetas || 0}</strong></p>
        <p>Amostras: <strong>${resumo.totalAmostras || 0}</strong> | Fora do limite: <strong>${resumo.amostrasForaLimite || 0}</strong></p>
        <p>Volume médio geral: <strong>${moeda(resumo.volumeMedioGeral)} mL</strong></p>
        <div class="actions"><button class="secondary" id="relatorioBtn">Relatório/PDF</button>${['administrador', 'qualidade'].includes(state.usuario.perfil) && carta.status === 'aberta' ? '<button id="fecharBtn">Fechar carta</button>' : ''}</div>
      </div>
    </section>
    <section class="panel"><h3>Gráfico do volume médio</h3><canvas id="chart" class="chart" width="900" height="310" aria-label="Gráfico de volume médio por coleta"></canvas></section>
    ${carta.status === 'aberta' && ['administrador', 'producao'].includes(state.usuario.perfil) ? formColeta(carta, coletas.length + 1) : ''}
    <section class="panel"><h3>Coletas registradas</h3>${tabelaColetas(coletas)}</section>
    <section class="panel" id="fechamentoPanel" hidden><h3>Fechamento</h3>${formFechamento(resumo)}</section>
  `, 'Detalhe da carta');
  desenharGrafico(carta, coletas);
  bindColetaForm(carta);
  document.querySelector('#relatorioBtn').addEventListener('click', () => relatorioView());
  document.querySelector('#fecharBtn')?.addEventListener('click', () => document.querySelector('#fechamentoPanel').hidden = false);
  bindFechamento(carta);
}

function formColeta(carta, numero) {
  return `<section class="panel"><h3>Registrar coleta</h3><form id="coletaForm">
    <div class="form-grid">
      <label>Número<input name="numeroColeta" type="number" value="${numero}" required></label>
      <label>Responsável<input name="responsavel" value="${state.usuario.nome}" required></label>
      <label>Data<input name="data" type="date" value="${hoje()}" required></label>
      <label>Hora<input name="hora" type="time" value="${horaAgora()}" required></label>
      <label>Tara embalagem g<input id="tara" name="taraEmbalagemG" type="number" step="0.001" required></label>
    </div>
    <div class="samples">${Array.from({ length: carta.quantidadeAmostras }, (_, i) => `<label>Peso bruto ${i + 1}<input class="peso" name="peso${i}" type="number" step="0.001"></label>`).join('')}</div>
    <div id="preview" class="hint"></div>
    <button type="submit">Salvar coleta</button>
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
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd);
    payload.pesosBrutos = [...form.querySelectorAll('.peso')].map((i) => i.value).filter(Boolean);
    await api(`/api/cartas/${carta.id}/coletas`, { method: 'POST', body: JSON.stringify(payload) });
    state.cartaAtual = await api(`/api/cartas/${carta.id}`);
    setToast('Coleta registrada.');
  });
}

function tabelaColetas(coletas) {
  return `<div class="table-wrap"><table><thead><tr><th>Coleta</th><th>Responsável</th><th>Data/Hora</th><th>Tara</th><th>Média bruto</th><th>Média volume</th><th>Menor/Maior</th><th>Status</th></tr></thead><tbody>
    ${coletas.map((c) => `<tr><td>${c.numeroColeta}</td><td>${c.responsavel}</td><td>${c.data} ${c.hora}</td><td>${moeda(c.taraEmbalagemG)} g</td><td>${moeda(c.resultado.mediaPesosBrutos)} g</td><td class="${c.status === 'reprovado' ? 'bad-cell' : ''}">${moeda(c.resultado.mediaVolumes)} mL</td><td>${moeda(c.resultado.menorVolume)} / ${moeda(c.resultado.maiorVolume)} mL</td><td>${statusBadge(c.status)}</td></tr>`).join('') || '<tr><td colspan="8">Nenhuma coleta registrada.</td></tr>'}
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
  ctx.strokeStyle = '#d8e0dc'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, canvas.height - pad); ctx.lineTo(canvas.width - pad, canvas.height - pad); ctx.stroke();
  [['Mínimo', carta.volumeMinimoMl, '#9a6700'], ['Máximo', carta.volumeMaximoMl, '#9a6700']].forEach(([label, val, color]) => {
    ctx.strokeStyle = color; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(pad, y(val)); ctx.lineTo(canvas.width - pad, y(val)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.fillText(`${label} ${moeda(val)}`, pad + 6, y(val) - 6);
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
      <label>Conferido por<input name="conferidoPor" value="${state.usuario.nome}" required></label>
      <label>Assinatura eletrônica<input name="assinaturaResponsavel" required></label>
    </div>
    <label>Justificativa<textarea name="justificativa"></textarea></label>
    <button type="submit">Finalizar carta</button>
  </form>`;
}

function bindFechamento(carta) {
  const form = document.querySelector('#fechamentoForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.cartaAtual = await api(`/api/cartas/${carta.id}/fechamento`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    await carregarBase();
    setToast('Carta finalizada.');
  });
}

async function relatorioView() {
  const { carta, coletas, resumo, impressoPor, impressoEm } = await api(`/api/cartas/${state.cartaAtual.carta.id}/relatorio`);
  shell(`
    <article class="report">
      <div class="report-header"><div><h1>Sobral - Carta de Peso</h1><p>Relatório de controle de envase por densidade</p></div><div><strong>Impresso por:</strong> ${impressoPor}<br><strong>Data:</strong> ${new Date(impressoEm).toLocaleString('pt-BR')}</div></div>
      <section class="grid two">
        <div><strong>Produto:</strong> ${carta.produtoNome}<br><strong>Lote:</strong> ${carta.lote}<br><strong>Volume declarado:</strong> ${moeda(carta.volumeDeclaradoMl)} mL<br><strong>Densidade:</strong> ${carta.densidade} g/mL</div>
        <div><strong>Limites volume:</strong> ${moeda(carta.volumeMinimoMl)} a ${moeda(carta.volumeMaximoMl)} mL<br><strong>Máquina:</strong> ${carta.maquinaEnvase}<br><strong>Linha:</strong> ${carta.linha}<br><strong>Balança:</strong> ${carta.balanca}</div>
      </section>
      ${tabelaColetas(coletas)}
      <p><strong>Volume médio geral:</strong> ${moeda(resumo.volumeMedioGeral)} mL | <strong>Menor:</strong> ${moeda(resumo.menorVolume)} mL | <strong>Maior:</strong> ${moeda(resumo.maiorVolume)} mL</p>
      <p><strong>Amostras aprovadas:</strong> ${resumo.amostrasAprovadas} | <strong>Fora do limite:</strong> ${resumo.amostrasForaLimite} | <strong>Status:</strong> ${resumo.statusFinalSugerido}</p>
      <p><strong>Conferido por:</strong> ${carta.conferidoPor || '________________________'} &nbsp; <strong>Assinatura:</strong> ${carta.assinaturaResponsavel || '________________________'}</p>
      <div class="actions no-print"><button onclick="window.print()">Gerar PDF / Imprimir</button><button class="secondary" id="voltarRel">Voltar</button></div>
    </article>
  `, 'Relatório');
  document.querySelector('#voltarRel').addEventListener('click', () => { state.view = 'detalheCarta'; render(); });
}

function historicoView() {
  shell(`
    <section class="panel">
      <h3>Histórico de cartas</h3>
      <div class="form-grid no-print">
        <label>Produto<input id="fProduto" placeholder="Filtrar produto"></label>
        <label>Lote<input id="fLote" placeholder="Filtrar lote"></label>
        <label>Status<select id="fStatus"><option value="">Todos</option><option value="aberta">Aberta</option><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option></select></label>
      </div>
      <div id="historicoTabela">${tabelaCartas(state.data.cartas)}</div>
    </section>
  `, 'Histórico e rastreabilidade');
  ['fProduto', 'fLote', 'fStatus'].forEach((id) => document.querySelector(`#${id}`).addEventListener('input', filtrarHistorico));
  bindCartaButtons();
}

function filtrarHistorico() {
  const produto = document.querySelector('#fProduto').value.toLowerCase();
  const lote = document.querySelector('#fLote').value.toLowerCase();
  const status = document.querySelector('#fStatus').value;
  const filtradas = state.data.cartas.filter((c) =>
    c.produtoNome.toLowerCase().includes(produto) &&
    c.lote.toLowerCase().includes(lote) &&
    (!status || c.status === status)
  );
  document.querySelector('#historicoTabela').innerHTML = tabelaCartas(filtradas);
  bindCartaButtons();
}

function auditoriaView() {
  shell(`<section class="panel"><h3>Log de auditoria</h3><div class="table-wrap"><table><thead><tr><th>Data</th><th>Usuário</th><th>Entidade</th><th>Ação</th><th>Valor novo</th></tr></thead><tbody>
    ${state.data.auditoria.map((a) => `<tr><td>${new Date(a.criado_em).toLocaleString('pt-BR')}</td><td>${a.usuario_nome}</td><td>${a.entidade} #${a.entidade_id}</td><td>${a.acao}</td><td><code>${(a.valor_novo || '').slice(0, 160)}</code></td></tr>`).join('')}
  </tbody></table></div></section>`, 'Auditoria');
}

function usuariosView() {
  simplesCadastro('usuarios', 'Usuários', `
    <div class="form-grid">
      <label>Nome<input name="nome" required></label><label>E-mail<input name="email" type="email" required></label>
      <label>Perfil<select name="perfil"><option value="administrador">Administrador</option><option value="producao">Produção</option><option value="qualidade">Qualidade</option></select></label>
      <label>Senha<input name="senha" type="password" required></label>
    </div>`, '/api/usuarios', '<p class="hint">Cadastre usuários por perfil para separar operação, qualidade e administração.</p>');
}

function render() {
  if (!state.token) return loginView();
  const views = { dashboard, produtos: produtosView, embalagens: embalagensView, maquinas: maquinasView, cartas: cartasView, detalheCarta: detalheCartaView, historico: historicoView, auditoria: auditoriaView, usuarios: usuariosView };
  return (views[state.view] || dashboard)();
}

(async function init() {
  if (!state.token) return loginView();
  try {
    await carregarBase();
    render();
  } catch {
    localStorage.clear();
    state.token = null;
    loginView();
  }
})();
