const app = document.querySelector('#app');
const LAYOUT = window.RQ6308_LAYOUT;

const state = {
  usuario: null,
  controle: null,
  saving: false,
  toast: '',
  saveTimer: null,
  observadorZoom: null,
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
    throw error;
  }
  return body;
}

function setToast(message) {
  state.toast = message;
  renderToast();
  setTimeout(() => {
    state.toast = '';
    renderToast();
  }, 2600);
}

async function carregarControle() {
  state.controle = await api('/api/controle-densidade');
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
    // Não substitui state.controle pela resposta: o usuário pode ter digitado
    // mais algo enquanto a requisição estava em voo.
    const salvo = await api('/api/controle-densidade', {
      method: 'PUT',
      body: JSON.stringify(state.controle),
    });
    state.controle.atualizadoEm = salvo.atualizadoEm;
  } catch (err) {
    setToast(err.message);
  } finally {
    state.saving = false;
    renderStatus();
  }
}

function mediaDez(pesos) {
  return pesos.map(parseNumero).reduce((soma, valor) => soma + valor, 0) / 10;
}

function calculos(verificacao) {
  const pesos = verificacao.pesos.map(parseNumero);
  const informados = pesos.filter((value) => value > 0);
  const media = informados.length ? informados.reduce((sum, value) => sum + value, 0) / informados.length : 0;
  const cab = state.controle.cabecalho;
  const densidade2 = parseNumero(cab.densidade2);
  const tara2 = mediaDez(cab.pesosEmbalagem2);
  const volumes = pesos.map((peso) => (peso > 0 && densidade2 > 0 ? (peso - tara2) / densidade2 : null));
  const validos = volumes.filter((value) => value !== null);
  const volume = validos.length ? validos.reduce((sum, value) => sum + value, 0) / validos.length : 0;
  return {
    media,
    volumes,
    volume,
    completa: informados.length === 10,
    volumeFora: validos.length > 0 && (volume < parseNumero(cab.minimoMl) || volume > parseNumero(cab.maximoMl)),
  };
}

// ---------------------------------------------------------------------------
// Planilha RQ 6308 — renderizada a partir de frontend/rq6308-layout.js, que é
// extraído do .xlsm oficial por backend/tools/extrair-layout-rq6308.py.
// ---------------------------------------------------------------------------

const COL_HEADER_PX = 32;
const ROW_HEADER_PX = 20;
const COL_VERIF_INICIO = 4; // D
const TOTAL_VERIFICACOES = 13;
const VERDE = '#00B050';
const VERMELHO = '#FF0000';

const letra = (c) => String.fromCharCode(64 + c);
const endereco = (c, r) => `${letra(c)}${r}`;
const celulasLayout = LAYOUT.celulas;
const mergesPorOrigem = new Map();
const cobertas = new Set();
LAYOUT.merges.forEach((m) => {
  mergesPorOrigem.set(endereco(m.c1, m.r1), m);
  for (let r = m.r1; r <= m.r2; r += 1) {
    for (let c = m.c1; c <= m.c2; c += 1) {
      if (r !== m.r1 || c !== m.c1) cobertas.add(endereco(c, r));
    }
  }
});

const CAMPOS_CABECALHO = {
  A6: ['produto', 'texto'],
  E6: ['lote', 'texto'],
  F6: ['volumeDeclaradoMl', 'numero'],
  J6: ['variacaoPermitidaPercentual', 'numero'],
  O6: ['maquinaTag', 'texto'],
  N8: ['linha', 'texto'],
  O8: ['tagBalanca', 'texto'],
  B26: ['densidade1', 'numero'],
  C26: ['densidade2', 'numero'],
  E52: ['impressoPor', 'texto'],
  N52: ['conferidoPor', 'texto'],
};
const CAMPOS_META = { 11: ['realizadoPor', 'texto'], 12: ['data', 'data'], 13: ['hora', 'hora'] };

function novaVerificacaoVazia() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    realizadoPor: '',
    data: '',
    hora: '',
    pesos: Array.from({ length: 10 }, () => 0),
  };
}

function garantirVerificacao(index) {
  const lista = state.controle.verificacoes;
  while (lista.length <= index) lista.push(novaVerificacaoVazia());
  return lista[index];
}

function vinculo(c, r) {
  const a = endereco(c, r);
  const cab = () => state.controle.cabecalho;
  if (CAMPOS_CABECALHO[a]) {
    const [campo, tipo] = CAMPOS_CABECALHO[a];
    return { tipo, ler: () => cab()[campo], gravar: (v) => { cab()[campo] = v; } };
  }
  if ((c === 2 || c === 3) && CAMPOS_META[r]) {
    const [campo, tipo] = CAMPOS_META[r];
    return {
      tipo,
      ler: () => cab().medicoesEmbalagem[c - 2][campo],
      gravar: (v) => { cab().medicoesEmbalagem[c - 2][campo] = v; },
    };
  }
  if ((c === 2 || c === 3) && r >= 15 && r <= 24) {
    const chave = `pesosEmbalagem${c - 1}`;
    return {
      tipo: 'numero',
      vazioSeZero: true,
      ler: () => cab()[chave][r - 15],
      gravar: (v) => { cab()[chave][r - 15] = v; },
    };
  }
  const iv = c - COL_VERIF_INICIO;
  if (iv >= 0 && iv < TOTAL_VERIFICACOES) {
    if (CAMPOS_META[r]) {
      const [campo, tipo] = CAMPOS_META[r];
      return {
        tipo,
        ler: () => state.controle.verificacoes[iv]?.[campo] ?? '',
        gravar: (v) => { garantirVerificacao(iv)[campo] = v; },
      };
    }
    if (r >= 15 && r <= 24) {
      return {
        tipo: 'numero',
        vazioSeZero: true,
        ler: () => state.controle.verificacoes[iv]?.pesos[r - 15] ?? 0,
        gravar: (v) => { garantirVerificacao(iv).pesos[r - 15] = v; },
      };
    }
  }
  return null;
}

// --- Formatos numéricos do Excel usados na ficha ---------------------------

function formatarNumero(valor, formato) {
  const m = /^0(?:\.(0+))?(?:\\ "(.*)")?/.exec(formato || '');
  if (!m) return String(valor).replace('.', ',');
  const casas = m[1] ? m[1].length : 0;
  const texto = valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: false });
  return m[2] ? `${texto} ${m[2]}` : texto;
}

function formatarData(iso, anoCompleto = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return `${m[3]}/${m[2]}/${anoCompleto ? m[1] : m[1].slice(2)}`;
}

function formatarHora(valor, comSegundos = false) {
  const m = /^(\d{1,2}):(\d{2})/.exec(valor || '');
  if (!m) return valor || '';
  const hh = m[1].padStart(2, '0');
  return comSegundos ? `${hh}:${m[2]}:00` : `${hh}:${m[2]}`;
}

function textoExibicao(vinc, formato) {
  const v = vinc.ler();
  if (vinc.tipo === 'numero') {
    const n = Number(v);
    if (v === '' || v === null || v === undefined || !Number.isFinite(n) || (vinc.vazioSeZero && n === 0)) return '';
    return formatarNumero(n, formato);
  }
  if (vinc.tipo === 'data') return formatarData(v);
  if (vinc.tipo === 'hora') return formatarHora(v);
  return v ?? '';
}

function textoEdicao(vinc) {
  const v = vinc.ler();
  if (vinc.tipo === 'numero') {
    const n = Number(v);
    if (v === '' || !Number.isFinite(n) || (vinc.vazioSeZero && n === 0)) return '';
    return String(n).replace('.', ',');
  }
  if (vinc.tipo === 'data') return formatarData(v, true);
  if (vinc.tipo === 'hora') return formatarHora(v);
  return v ?? '';
}

// Retorna o valor interpretado ou `undefined` quando o texto é inválido.
function interpretar(texto, tipo) {
  const t = String(texto ?? '').trim();
  if (tipo === 'numero') {
    if (!t) return 0;
    const n = Number(t.replace(/[^\d,.-]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  if (tipo === 'data') {
    if (!t) return '';
    const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
    if (!m) return undefined;
    const ano = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(new Date().getFullYear());
    const dia = m[1].padStart(2, '0');
    const mes = m[2].padStart(2, '0');
    if (Number(mes) < 1 || Number(mes) > 12 || Number(dia) < 1 || Number(dia) > 31) return undefined;
    return `${ano}-${mes}-${dia}`;
  }
  if (tipo === 'hora') {
    if (!t) return '';
    const m = /^(\d{1,2})(?:[:h]?(\d{2}))?$/.exec(t);
    if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) return undefined;
    return `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
  }
  return t;
}

// --- Fórmulas da ficha (mesmas do .xlsm) -----------------------------------

function avaliar() {
  const cab = state.controle.cabecalho;
  const tara1 = mediaDez(cab.pesosEmbalagem1); // B25 =SUM(B15:B24)/10
  const tara2 = mediaDez(cab.pesosEmbalagem2); // C25 =SUM(C15:C24)/10
  const densidade1 = parseNumero(cab.densidade1);
  const densidade2 = parseNumero(cab.densidade2);
  const declarado = parseNumero(cab.volumeDeclaradoMl);
  const variacao = parseNumero(cab.variacaoPermitidaPercentual);
  const minimo = declarado; // L7 =F6
  const maximo = declarado + (variacao * declarado / 100); // L8 =F6+(J6*F6/100)
  const valores = { H7: densidade2, H8: tara2, L7: minimo, L8: maximo, B25: tara1, C25: tara2 };
  const medias = [];
  for (let i = 0; i < TOTAL_VERIFICACOES; i += 1) {
    const col = letra(COL_VERIF_INICIO + i);
    const verificacao = state.controle.verificacoes[i];
    valores[`${col}30`] = verificacao?.hora || ''; // =D13
    const volumes = [];
    for (let j = 0; j < 10; j += 1) {
      const peso = parseNumero(verificacao?.pesos?.[j]);
      const volume = peso > 0 && densidade2 > 0 ? (peso - tara2) / densidade2 : ''; // =(D15-$H$8)/$H$7
      valores[`${col}${31 + j}`] = volume;
      if (volume !== '') volumes.push(volume);
    }
    const media = volumes.length ? volumes.reduce((s, x) => s + x, 0) / volumes.length : ''; // =AVERAGE(D31:D40)
    valores[`${col}28`] = media;
    medias.push(media);
  }
  return {
    valores,
    minimo,
    maximo,
    medias,
    taraDivergente: Number(tara1.toFixed(2)) !== Number(tara2.toFixed(2)),
    densidadeDivergente: Number(densidade1.toFixed(4)) !== Number(densidade2.toFixed(4)),
  };
}

// Formatação condicional do .xlsm (só cor da fonte, como no original).
function corCondicional(c, r, ctx) {
  const a = endereco(c, r);
  if ((a === 'B25' || a === 'C25') && ctx.taraDivergente) return VERMELHO;
  if ((a === 'B26' || a === 'C26') && ctx.densidadeDivergente) return VERMELHO;
  const faixaVolume = c >= COL_VERIF_INICIO && c < COL_VERIF_INICIO + TOTAL_VERIFICACOES && (r === 28 || (r >= 31 && r <= 40));
  if (faixaVolume) {
    const x = ctx.valores[a];
    if (typeof x === 'number') {
      if (x >= ctx.minimo && x <= ctx.maximo) return VERDE;
      if ((x >= 0 && x < ctx.minimo) || x > ctx.maximo) return VERMELHO;
    }
  }
  return null;
}

function temCorCondicional(c, r) {
  const a = endereco(c, r);
  if (['B25', 'C25', 'B26', 'C26'].includes(a)) return true;
  return c >= COL_VERIF_INICIO && c < COL_VERIF_INICIO + TOTAL_VERIFICACOES && (r === 28 || (r >= 31 && r <= 40));
}

function textoFormula(a, ctx) {
  const x = ctx.valores[a];
  if (x === '' || x === null || x === undefined) return '';
  if (/^[D-P]30$/.test(a)) return formatarHora(x, true);
  return formatarNumero(x, celulasLayout[a]?.fmt);
}

function textoFrequencia() {
  const cab = state.controle.cabecalho;
  return `FREQUÊNCIA: A CADA ${cab.frequenciaMinutos} MINUTOS, COM TOLERÂNCIA DE ${cab.toleranciaMinutos} MINUTOS. `;
}

// --- Renderização ----------------------------------------------------------

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function bordasDaCelula(c, r) {
  const merge = mergesPorOrigem.get(endereco(c, r));
  const s = celulasLayout[endereco(c, r)]?.s || {};
  if (!merge) {
    return { top: s.border_top, right: s.border_right, bottom: s.border_bottom, left: s.border_left };
  }
  const primeira = (enderecos, lado) => {
    for (const a of enderecos) {
      const borda = celulasLayout[a]?.s?.[`border_${lado}`];
      if (borda) return borda;
    }
    return undefined;
  };
  const colunas = [];
  for (let x = merge.c1; x <= merge.c2; x += 1) colunas.push(x);
  const linhas = [];
  for (let y = merge.r1; y <= merge.r2; y += 1) linhas.push(y);
  return {
    top: primeira(colunas.map((x) => endereco(x, merge.r1)), 'top'),
    bottom: primeira(colunas.map((x) => endereco(x, merge.r2)), 'bottom'),
    left: primeira(linhas.map((y) => endereco(merge.c1, y)), 'left'),
    right: primeira(linhas.map((y) => endereco(merge.c2, y)), 'right'),
  };
}

function aplicarEstilo(td, s, bordas, ehNumero) {
  td.style.fontFamily = `${s.fontFamily || 'Arial'}, Arial, sans-serif`;
  td.style.fontSize = `${s.fontSize || 10}pt`;
  if (s.bold) td.style.fontWeight = '700';
  if (s.italic) td.style.fontStyle = 'italic';
  if (s.underline) td.style.textDecoration = 'underline';
  if (s.color) td.style.color = s.color;
  if (s.fill) td.style.backgroundColor = s.fill;
  if (bordas.top) td.style.borderTop = bordas.top;
  if (bordas.right) td.style.borderRight = bordas.right;
  if (bordas.bottom) td.style.borderBottom = bordas.bottom;
  if (bordas.left) td.style.borderLeft = bordas.left;
  const horizontal = s.h === 'centerContinuous' ? 'center' : s.h;
  if (horizontal && horizontal !== 'general') {
    td.style.textAlign = ['justify', 'distributed', 'fill'].includes(horizontal) ? 'left' : horizontal;
  } else {
    td.style.textAlign = ehNumero ? 'right' : 'left';
  }
  td.style.verticalAlign = s.v === 'center' ? 'middle' : (s.v === 'top' ? 'top' : 'bottom');
  td.style.whiteSpace = s.wrap ? 'pre-wrap' : 'pre';
}

// Âncoras de imagem/gráfico do Excel são (coluna, linha, deslocamento em px).
// Mede a grade já renderizada, porque a altura real das linhas no navegador
// pode diferir alguns px da altura nominal do Excel e o erro acumularia.
function criarMedidor(area) {
  const base = area.getBoundingClientRect();
  const colunas = [...area.querySelectorAll('th.xls-colhead')].map((th) => th.getBoundingClientRect().left - base.left);
  const linhas = new Map();
  area.querySelectorAll('tbody tr[data-linha]').forEach((tr) => {
    linhas.set(Number(tr.dataset.linha), tr.getBoundingClientRect().top - base.top);
  });
  return {
    x: (coluna0, deslocamento) => colunas[coluna0] + deslocamento,
    y: (linha0, deslocamento) => {
      for (let r = linha0 + 1; r <= LAYOUT.linhas.length; r += 1) {
        if (linhas.has(r)) return linhas.get(r) + deslocamento;
      }
      return deslocamento;
    },
  };
}

function criarInput(td, c, r, vinc) {
  const a = endereco(c, r);
  const formato = celulasLayout[a]?.fmt;
  td.classList.add('xls-edit');
  const input = el('input', 'xls-input');
  input.type = 'text';
  input.dataset.addr = a;
  input.setAttribute('aria-label', `Célula ${a}`);
  input.autocomplete = 'off';
  if (vinc.tipo === 'numero') input.inputMode = 'decimal';
  input.value = textoExibicao(vinc, formato);
  let original = '';

  input.addEventListener('focus', () => {
    original = textoEdicao(vinc);
    input.value = original;
    input.select();
  });
  input.addEventListener('input', () => {
    if (vinc.tipo !== 'numero' && vinc.tipo !== 'texto') return; // data/hora só ao sair da célula
    const valor = interpretar(input.value, vinc.tipo);
    if (valor === undefined) return;
    vinc.gravar(valor);
    atualizarFormulas();
    salvarDepois();
  });
  input.addEventListener('blur', () => {
    const valor = interpretar(input.value, vinc.tipo);
    if (valor === undefined) {
      setToast(`Valor inválido em ${a}.`);
    } else if (textoEdicao(vinc) !== input.value.trim() || vinc.tipo === 'data' || vinc.tipo === 'hora') {
      vinc.gravar(valor);
      atualizarFormulas();
      salvarDepois();
    }
    input.value = textoExibicao(vinc, formato);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = original;
      input.blur();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      moverFoco(c, r, event.shiftKey ? -1 : 1);
    }
  });
  td.append(input);
}

function moverFoco(c, r, direcao) {
  for (let y = r + direcao; y >= 1 && y <= LAYOUT.linhas.length; y += direcao) {
    const alvo = document.querySelector(`.xls-input[data-addr="${endereco(c, y)}"]`);
    if (alvo) {
      alvo.focus();
      return;
    }
  }
  document.activeElement?.blur();
}

function montarPlanilha(host) {
  const ctx = avaliar();
  const larguraTotal = COL_HEADER_PX + LAYOUT.colunas.reduce((soma, col) => soma + col.px, 0);

  const area = el('div', 'xls-area');
  const table = el('table', 'xls');
  table.style.width = `${larguraTotal}px`;

  const colgroup = el('colgroup');
  const colCabecalho = el('col');
  colCabecalho.style.width = `${COL_HEADER_PX}px`;
  colgroup.append(colCabecalho);
  LAYOUT.colunas.forEach((coluna) => {
    const col = el('col');
    col.style.width = `${coluna.px}px`;
    colgroup.append(col);
  });
  table.append(colgroup);

  const thead = el('thead');
  const trLetras = el('tr');
  trLetras.style.height = `${ROW_HEADER_PX}px`;
  trLetras.append(el('th', 'xls-corner'));
  LAYOUT.colunas.forEach((coluna) => {
    const th = el('th', 'xls-colhead');
    th.textContent = coluna.letra;
    trLetras.append(th);
  });
  thead.append(trLetras);
  table.append(thead);

  const tbody = el('tbody');
  LAYOUT.linhas.forEach(({ r, px, oculta }) => {
    if (oculta) return;
    const tr = el('tr');
    tr.dataset.linha = String(r);
    tr.style.height = `${px}px`;
    const th = el('th', 'xls-rowhead');
    th.textContent = String(r);
    tr.append(th);

    for (let c = 1; c <= LAYOUT.colunas.length; c += 1) {
      const a = endereco(c, r);
      if (cobertas.has(a)) continue;
      const td = el('td');
      const merge = mergesPorOrigem.get(a);
      if (merge) {
        if (merge.c2 > merge.c1) td.colSpan = merge.c2 - merge.c1 + 1;
        if (merge.r2 > merge.r1) td.rowSpan = merge.r2 - merge.r1 + 1;
      }
      const celula = celulasLayout[a] || { s: {} };
      const vinc = vinculo(c, r);
      const ehNumero = Boolean(celula.f) || vinc?.tipo === 'numero' || typeof celula.v === 'number';
      aplicarEstilo(td, celula.s || {}, bordasDaCelula(c, r), ehNumero);
      if (temCorCondicional(c, r)) {
        td.dataset.cf = a;
        td.dataset.corBase = celula.s?.color || '';
        const cor = corCondicional(c, r, ctx);
        if (cor) td.style.color = cor;
      }

      if (vinc) {
        criarInput(td, c, r, vinc);
      } else if (celula.f) {
        td.dataset.formula = a;
        td.textContent = textoFormula(a, ctx);
      } else if (a === 'A7') {
        td.dataset.frequencia = 'true';
        td.textContent = textoFrequencia();
      } else if (celula.v !== undefined && celula.v !== null) {
        td.textContent = typeof celula.v === 'number' ? formatarNumero(celula.v, celula.fmt) : String(celula.v);
      }
      tr.append(td);
    }
    tbody.append(tr);
  });
  table.append(tbody);
  area.append(table);
  host.replaceChildren(area);

  const medida = criarMedidor(area);

  const { logo } = LAYOUT;
  const img = el('img', 'xls-logo');
  img.src = logo.dataUri;
  img.alt = 'Logo Sobral';
  const logoX = medida.x(logo.de.col, logo.de.colOffPx);
  const logoY = medida.y(logo.de.row, logo.de.rowOffPx);
  img.style.left = `${logoX}px`;
  img.style.top = `${logoY}px`;
  img.style.width = `${medida.x(logo.ate.col, logo.ate.colOffPx) - logoX}px`;
  img.style.height = `${medida.y(logo.ate.row, logo.ate.rowOffPx) - logoY}px`;
  area.append(img);

  const { grafico } = LAYOUT;
  const gx = medida.x(grafico.de.col, grafico.de.colOffPx);
  const gy = medida.y(grafico.de.row, grafico.de.rowOffPx);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('xls-grafico');
  svg.id = 'xlsGrafico';
  svg.setAttribute('width', String(Math.round(medida.x(grafico.ate.col, grafico.ate.colOffPx) - gx)));
  svg.setAttribute('height', String(Math.round(medida.y(grafico.ate.row, grafico.ate.rowOffPx) - gy)));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Volume médio durante o processo');
  svg.style.left = `${gx}px`;
  svg.style.top = `${gy}px`;
  area.append(svg);

  desenharGrafico(ctx);
  // Zoom só depois de medir/posicionar: as âncoras acima ficam em px sem zoom.
  observarLargura(host, area);
}

// "Ajustar à largura" do Excel: escala a ficha inteira para caber na área
// disponível, preservando o layout exato em qualquer tamanho de tela.
const ZOOM_MINIMO = 0.3;
const ZOOM_MAXIMO = 1.5;

function observarLargura(host, area) {
  state.observadorZoom?.disconnect();
  const larguraNatural = area.offsetWidth;
  let quadro = 0;
  const ajustar = () => {
    cancelAnimationFrame(quadro);
    quadro = requestAnimationFrame(() => {
      const disponivel = host.clientWidth;
      if (!disponivel) return;
      const zoom = Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, Math.floor((disponivel / larguraNatural) * 1000) / 1000));
      area.style.zoom = String(zoom);
    });
  };
  state.observadorZoom = new ResizeObserver(ajustar);
  state.observadorZoom.observe(host);
  ajustar();
}

function atualizarFormulas() {
  const ctx = avaliar();
  document.querySelectorAll('[data-formula]').forEach((td) => {
    td.textContent = textoFormula(td.dataset.formula, ctx);
  });
  document.querySelectorAll('[data-cf]').forEach((td) => {
    const m = /^([A-Z])(\d+)$/.exec(td.dataset.cf);
    const cor = corCondicional(m[1].charCodeAt(0) - 64, Number(m[2]), ctx);
    td.style.color = cor || td.dataset.corBase || '';
  });
  const frequencia = document.querySelector('[data-frequencia]');
  if (frequencia) frequencia.textContent = textoFrequencia();
  desenharGrafico(ctx);
}

// --- Gráfico "VOLUME MÉDIO DURANTE O PROCESSO" (linha com marcadores) ------

function escalaEixo(valores, alturaPlot) {
  const numeros = valores.filter((v) => typeof v === 'number');
  if (!numeros.length) return { min: 0, max: 1, passo: 0.2 };
  let lo = Math.min(...numeros);
  let hi = Math.max(...numeros);
  if (lo >= 0 && lo <= hi * 5 / 6) lo = 0; // como o Excel: inclui o zero se a faixa for ampla
  if (hi === lo) {
    hi += Math.abs(hi) * 0.01 || 1;
    lo -= Math.abs(lo) * 0.01 || 0;
  }
  const maxIntervalos = Math.max(2, Math.floor(alturaPlot / 28));
  const bruto = (hi - lo) / maxIntervalos;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 5, 10].map((m) => m * potencia).find((p) => p >= bruto - 1e-12);
  const min = Math.floor(lo / passo + 1e-9) * passo;
  let max = Math.ceil(hi / passo - 1e-9) * passo;
  if (max <= min) max = min + passo;
  return { min, max, passo };
}

function desenharGrafico(ctx) {
  const svg = document.querySelector('#xlsGrafico');
  if (!svg) return;
  const W = Number(svg.getAttribute('width'));
  const H = Number(svg.getAttribute('height'));
  // Layout manual do plotArea no chart1.xml original
  const x0 = W * 0.0574;
  const y0 = H * 0.1093;
  const pw = W * 0.9309;
  const ph = H * 0.7046;
  const { min, max, passo } = escalaEixo(ctx.medias, ph);
  const escalaY = (v) => y0 + ph - ((v - min) / (max - min)) * ph;
  const larguraCategoria = pw / TOTAL_VERIFICACOES;
  const cor = LAYOUT.corSerieGrafico;
  const casas = Math.max(2, Math.ceil(-Math.log10(passo) - 1e-9));
  const formatoEixo = `0.${'0'.repeat(casas)}`;
  const partes = [];

  partes.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="#FFFFFF" stroke="#868686"/>`);
  for (let t = min; t <= max + passo / 1000; t += passo) {
    const y = escalaY(t);
    partes.push(`<line x1="${x0}" y1="${y}" x2="${x0 + pw}" y2="${y}" stroke="#D9D9D9"/>`);
    partes.push(`<line x1="${x0 - 4}" y1="${y}" x2="${x0}" y2="${y}" stroke="#868686"/>`);
    partes.push(`<text x="${x0 - 6}" y="${y + 4}" text-anchor="end" class="xls-grafico-rotulo">${formatarNumero(t, formatoEixo)}</text>`);
  }
  const eixoX = min <= 0 && max >= 0 ? escalaY(0) : escalaY(min);
  partes.push(`<line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y0 + ph}" stroke="#868686"/>`);
  partes.push(`<line x1="${x0}" y1="${eixoX}" x2="${x0 + pw}" y2="${eixoX}" stroke="#868686"/>`);
  for (let i = 0; i <= TOTAL_VERIFICACOES; i += 1) {
    const x = x0 + i * larguraCategoria;
    partes.push(`<line x1="${x}" y1="${eixoX}" x2="${x}" y2="${eixoX + 4}" stroke="#868686"/>`);
  }
  for (let i = 0; i < TOTAL_VERIFICACOES; i += 1) {
    const x = x0 + (i + 0.5) * larguraCategoria;
    partes.push(`<text x="${x}" y="${y0 + ph + 16}" text-anchor="middle" class="xls-grafico-rotulo">${i + 1}</text>`);
  }

  let trecho = [];
  const trechos = [];
  const pontos = [];
  ctx.medias.forEach((v, i) => {
    if (typeof v !== 'number') {
      if (trecho.length) trechos.push(trecho);
      trecho = [];
      return;
    }
    const ponto = [x0 + (i + 0.5) * larguraCategoria, escalaY(v)];
    trecho.push(ponto);
    pontos.push(ponto);
  });
  if (trecho.length) trechos.push(trecho);
  trechos.filter((t) => t.length > 1).forEach((t) => {
    partes.push(`<polyline points="${t.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${cor}" stroke-width="3" stroke-linejoin="round"/>`);
  });
  pontos.forEach(([x, y]) => {
    partes.push(`<polygon points="${x},${y - 4} ${x + 4},${y} ${x},${y + 4} ${x - 4},${y}" fill="${cor}" stroke="${cor}"/>`);
  });
  svg.innerHTML = partes.join('');
}

// --- Casca da tela ----------------------------------------------------------

function verificacaoVazia(v) {
  return !v || (!v.realizadoPor && !v.data && !v.hora && v.pesos.every((p) => !parseNumero(p)));
}

function novaVerificacao() {
  const lista = state.controle.verificacoes;
  let index = lista.findIndex(verificacaoVazia);
  if (index === -1) index = lista.length;
  if (index >= TOTAL_VERIFICACOES) {
    setToast('A ficha permite no máximo 13 verificações.');
    return;
  }
  const anterior = lista.slice(0, index).reverse().find((v) => v.data && v.hora);
  let data = hoje();
  let hora = horaAgora();
  if (anterior) {
    const prevista = new Date(`${anterior.data}T${anterior.hora}:00`);
    prevista.setMinutes(prevista.getMinutes() + parseNumero(state.controle.cabecalho.frequenciaMinutos || 30));
    data = dataLocal(prevista);
    hora = prevista.toTimeString().slice(0, 5);
  }
  const verificacao = garantirVerificacao(index);
  verificacao.data = data;
  verificacao.hora = hora;
  salvarAgora();
  render();
  document.querySelector(`.xls-input[data-addr="${endereco(COL_VERIF_INICIO + index, 11)}"]`)?.focus();
}

function renderStatus() {
  const status = document.querySelector('#saveStatus');
  if (status) status.textContent = state.saving ? 'Salvando...' : 'Salvo no banco';
}

function renderToast() {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = state.toast;
  toast.hidden = !state.toast;
}

function render() {
  if (!state.controle) {
    app.innerHTML = '<main class="loading">Carregando controle...</main>';
    return;
  }
  app.innerHTML = `
    <div class="app-shell split-shell">
      <aside class="internal-sidebar">
        <div class="internal-brand">
          <span class="mark">CP</span>
          <div>
            <h1>CARTAS DE PESO</h1>
            <small>Controle de densidade · Sobral</small>
          </div>
        </div>
        <nav class="internal-tabs" aria-label="Acoes internas">
          <span class="nav-label">Menu principal</span>
          <button type="button" class="active" data-tab="cartas"><span aria-hidden="true">▦</span> Cartas de peso</button>
        </nav>
        <div class="sidebar-footer">
          <span class="save-indicator"><i aria-hidden="true"></i><span id="saveStatus">Dados carregados</span></span>
        </div>
      </aside>
      <main class="internal-main xls-main">
        <div class="xls-toolbar">
          <strong>RQ 6308 REV 03 — Volume pela Densidade</strong>
          <div class="actions">
            <button class="secondary" id="csvBtn" type="button">Baixar CSV</button>
            <button class="secondary" id="excelBtn" type="button">Baixar Excel</button>
            <button id="addColumnBtn" type="button">+ Nova verificação</button>
          </div>
        </div>
        <div class="toast" id="toast" role="status" ${state.toast ? '' : 'hidden'}>${h(state.toast)}</div>
        <div class="xls-janela">
          <div class="xls-wrap" id="planilha"></div>
          <div class="xls-abas"><span class="xls-aba ativa">${h(LAYOUT.aba.replace(/\s*\(\d+\)$/, ''))}</span></div>
        </div>
      </main>
    </div>
  `;
  montarPlanilha(document.querySelector('#planilha'));
  document.querySelector('#addColumnBtn').addEventListener('click', novaVerificacao);
  document.querySelector('#csvBtn').addEventListener('click', exportarCsv);
  document.querySelector('#excelBtn').addEventListener('click', exportarExcel);
  renderStatus();
}

// --- Exportações ------------------------------------------------------------

function linhasExportacao() {
  const cab = state.controle.cabecalho;
  const cols = state.controle.verificacoes;
  return [
    ['Produto', cab.produto],
    ['Lote', cab.lote],
    ['Volume declarado (mL)', cab.volumeDeclaradoMl],
    ['Variação permitida (%)', cab.variacaoPermitidaPercentual],
    ['Densidade (g/mL) — medição 1', cab.densidade1],
    ['Densidade (g/mL) — medição 2 (usada no cálculo)', cab.densidade2],
    ['Peso Emb. Primária (g) — média medição 1', mediaDez(cab.pesosEmbalagem1)],
    ['Peso Emb. Primária (g) — média medição 2 (usada no cálculo)', mediaDez(cab.pesosEmbalagem2)],
    ['Mínimo (mL)', cab.minimoMl],
    ['Máximo (mL)', cab.maximoMl],
    ['Máquina (TAG)', cab.maquinaTag],
    ['Linha', cab.linha],
    ['TAG Balança', cab.tagBalanca],
    ['Frequência', `a cada ${cab.frequenciaMinutos} minutos, tolerância de ${cab.toleranciaMinutos} minutos`],
    ['Impresso por', cab.impressoPor],
    ['Conferido por', cab.conferidoPor],
    [],
    ['Campo', ...cols.map((_, index) => `Verificação ${index + 1}`)],
    ['Realizado por', ...cols.map((col) => col.realizadoPor)],
    ['Data', ...cols.map((col) => col.data)],
    ['Hora', ...cols.map((col) => col.hora)],
    ...Array.from({ length: 10 }, (_, index) => [`${index + 1}º peso (g)`, ...cols.map((col) => col.pesos[index] || '')]),
    ...Array.from({ length: 10 }, (_, index) => [`${index + 1}º volume (mL)`, ...cols.map((col) => calculos(col).volumes[index] ?? '')]),
    ['Peso médio (g)', ...cols.map((col) => calculos(col).media || '')],
    ['Média de volume (mL)', ...cols.map((col) => calculos(col).volume || '')],
    ['Situação', ...cols.map((col) => (calculos(col).volumeFora ? 'Fora da faixa' : 'Conforme'))],
  ];
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
  baixar(nomeArquivoExportacao('csv'), `﻿${csv}`, 'text/csv;charset=utf-8');
}

function nomeArquivoExportacao(extensao) {
  const lote = String(state.controle.cabecalho.lote || 'sem-lote')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `controle-densidade_${lote || 'sem-lote'}_${hoje()}.${extensao}`;
}

async function exportarExcel() {
  try {
    const res = await fetch('/api/controle-densidade/exportacao?formato=xlsx', { credentials: 'same-origin' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message || 'Não foi possível gerar o Excel.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivoExportacao('xlsx');
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    setToast(err.message);
  }
}

(async function init() {
  try {
    const session = await api('/api/me');
    state.usuario = session.usuario;
    await carregarControle();
    render();
  } catch (err) {
    app.innerHTML = `<main class="loading">${h(err.message)}</main>`;
  }
}());
