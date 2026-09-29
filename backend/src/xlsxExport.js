const ExcelJS = require('exceljs');

const AZUL = 'FF0000FF';
const VERMELHO_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
const VERDE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
const CINZA_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

function coluna(index) {
  // index 0 -> D, 1 -> E, ...
  return String.fromCharCode('D'.charCodeAt(0) + index);
}

function estiloTitulo() {
  return { name: 'Arial', size: 14, bold: true };
}

function estiloRotulo() {
  return { name: 'Arial', size: 9, bold: true };
}

function estiloInput() {
  return { name: 'Arial', size: 10, color: { argb: AZUL } };
}

function estiloFormula() {
  return { name: 'Arial', size: 10 };
}

function centro() {
  return { horizontal: 'center', vertical: 'middle', wrapText: true };
}

/**
 * Gera o .xlsx do "Controle de Densidade" (RQ 6308) a partir dos dados
 * atualmente salvos no sistema. Fórmulas replicam docs/analise-formulas-rq6308.md.
 * @param {object} dados - retorno de carregarControle()
 * @returns {Promise<Buffer>}
 */
async function gerarPlanilhaControleDensidade(dados) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cartas de Peso Sobral';
  wb.created = new Date();

  const ws = wb.addWorksheet('Volume pela Densidade', { views: [{ showGridLines: false }] });
  const cab = dados.cabecalho;
  const verificacoes = dados.verificacoes.slice(0, 13);
  const qtdCols = Math.max(verificacoes.length, 1);
  const ultimaColuna = coluna(qtdCols - 1);

  ws.getColumn('A').width = 22;
  ws.getColumn('B').width = 11;
  ws.getColumn('C').width = 11;
  for (let i = 0; i < 13; i += 1) ws.getColumn(coluna(i)).width = 10;

  // Cabeçalho
  ws.mergeCells('A1:C1');
  ws.getCell('A1').value = `REGISTRO DE QUALIDADE — RQ ${cab.rqNumero} REV ${cab.rqRevisao}`;
  ws.getCell('A1').font = estiloTitulo();

  ws.mergeCells(`A2:${ultimaColuna}2`);
  ws.getCell('A2').value = 'FICHA DE CONTROLE EM PROCESSO DE VOLUME PELA DENSIDADE DE SUPLEMENTO LÍQUIDO';
  ws.getCell('A2').font = { name: 'Arial', size: 11, bold: true };
  ws.getCell('A2').alignment = centro();

  const linhasCabecalho = [
    ['Produto', cab.produto, 'Lote', cab.lote],
    ['Volume declarado (mL)', cab.volumeDeclaradoMl, 'Variação permitida (%)', cab.variacaoPermitidaPercentual],
    ['Máquina (TAG)', cab.maquinaTag, 'Linha', cab.linha],
    ['TAG Balança', cab.tagBalanca, 'Frequência (min)', cab.frequenciaMinutos],
    ['Densidade (g/mL)', cab.densidadeProdutoGml, 'Peso Emb. Primária (g)', cab.pesoEmbPrimariaG],
  ];
  const linhaEspecificacao = 8; // B8 = densidade (H7 da ficha), D8 = peso emb. primária (H8)
  let linha = 4;
  linhasCabecalho.forEach(([labelA, valorA, labelB, valorB]) => {
    ws.getCell(`A${linha}`).value = labelA;
    ws.getCell(`A${linha}`).font = estiloRotulo();
    ws.getCell(`B${linha}`).value = valorA;
    ws.getCell(`B${linha}`).font = estiloInput();
    ws.getCell(`C${linha}`).value = labelB;
    ws.getCell(`C${linha}`).font = estiloRotulo();
    ws.getCell(`D${linha}`).value = valorB;
    ws.getCell(`D${linha}`).font = estiloInput();
    linha += 1;
  });

  // Mínimo / Máximo (fórmulas, iguais a L7=F6 e L8=F6+(J6*F6/100) do original)
  const linhaVolDeclarado = 5; // B5 = volume declarado
  const linhaVariacao = 5; // D5 = variação
  ws.getCell(`A${linha}`).value = 'Mínimo (mL)';
  ws.getCell(`A${linha}`).font = estiloRotulo();
  ws.getCell(`B${linha}`).value = { formula: `B${linhaVolDeclarado}` };
  ws.getCell(`B${linha}`).font = estiloFormula();
  ws.getCell(`C${linha}`).value = 'Máximo (mL)';
  ws.getCell(`C${linha}`).font = estiloRotulo();
  ws.getCell(`D${linha}`).value = { formula: `B${linhaVolDeclarado}+(D${linhaVariacao}*B${linhaVolDeclarado}/100)` };
  ws.getCell(`D${linha}`).font = estiloFormula();
  const linhaMinimo = linha;
  const linhaMaximo = linha;
  linha += 2;

  // Tara (duas medições de 10 pesagens)
  ws.mergeCells(`A${linha}:D${linha}`);
  ws.getCell(`A${linha}`).value = 'PESO DA EMBALAGEM (TARA) — DUAS MEDIÇÕES';
  ws.getCell(`A${linha}`).font = { name: 'Arial', size: 10, bold: true };
  ws.getCell(`A${linha}`).fill = CINZA_FILL;
  linha += 1;
  ws.getCell(`B${linha}`).value = 'Medição 1';
  ws.getCell(`B${linha}`).font = estiloRotulo();
  ws.getCell(`C${linha}`).value = 'Medição 2';
  ws.getCell(`C${linha}`).font = estiloRotulo();
  linha += 1;
  const linhaPrimeiraTara = linha;
  for (let i = 0; i < 10; i += 1) {
    ws.getCell(`A${linha}`).value = `${i + 1}º peso (g)`;
    ws.getCell(`A${linha}`).font = estiloRotulo();
    ws.getCell(`B${linha}`).value = cab.pesosEmbalagem1[i] || null;
    ws.getCell(`B${linha}`).font = estiloInput();
    ws.getCell(`B${linha}`).numFmt = '0.00';
    ws.getCell(`C${linha}`).value = cab.pesosEmbalagem2[i] || null;
    ws.getCell(`C${linha}`).font = estiloInput();
    ws.getCell(`C${linha}`).numFmt = '0.00';
    linha += 1;
  }
  const linhaUltimaTara = linha - 1;
  ws.getCell(`A${linha}`).value = 'média';
  ws.getCell(`A${linha}`).font = estiloRotulo();
  ws.getCell(`B${linha}`).value = { formula: `SUM(B${linhaPrimeiraTara}:B${linhaUltimaTara})/10` };
  ws.getCell(`C${linha}`).value = { formula: `SUM(C${linhaPrimeiraTara}:C${linhaUltimaTara})/10` };
  ws.getCell(`B${linha}`).font = estiloFormula();
  ws.getCell(`C${linha}`).font = estiloFormula();
  ws.getCell(`B${linha}`).numFmt = '0.00';
  ws.getCell(`C${linha}`).numFmt = '0.00';
  ws.addConditionalFormatting({
    ref: `B${linha}:C${linha}`,
    rules: [{ type: 'expression', formulae: [`ROUND($B$${linha},2)<>ROUND($C$${linha},2)`], style: { fill: VERMELHO_FILL }, priority: 1 }],
  });
  linha += 2;

  // Densidade (duas medições)
  ws.getCell(`A${linha}`).value = 'Densidade (g/mL)';
  ws.getCell(`A${linha}`).font = estiloRotulo();
  ws.getCell(`B${linha}`).value = cab.densidade1 || null;
  ws.getCell(`C${linha}`).value = cab.densidade2 || null;
  ws.getCell(`B${linha}`).font = estiloInput();
  ws.getCell(`C${linha}`).font = estiloInput();
  ws.getCell(`B${linha}`).numFmt = '0.0000';
  ws.getCell(`C${linha}`).numFmt = '0.0000';
  ws.addConditionalFormatting({
    ref: `B${linha}:C${linha}`,
    rules: [{ type: 'expression', formulae: [`ROUND($B$${linha},4)<>ROUND($C$${linha},4)`], style: { fill: VERMELHO_FILL }, priority: 1 }],
  });
  linha += 1;
  ws.mergeCells(`D${linha - 1}:${ultimaColuna}${linha - 1}`);
  ws.getCell(`D${linha - 1}`).value = 'Legenda: se a tara ou a densidade das duas medições forem diferentes, ficam vermelhas e devem ser reavaliadas.';
  ws.getCell(`D${linha - 1}`).font = { name: 'Arial', size: 8, italic: true };
  ws.getCell(`D${linha - 1}`).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  linha += 1;

  // Verificações
  ws.mergeCells(`A${linha}:${ultimaColuna}${linha}`);
  ws.getCell(`A${linha}`).value = 'VERIFICAÇÕES';
  ws.getCell(`A${linha}`).font = { name: 'Arial', size: 11, bold: true };
  ws.getCell(`A${linha}`).fill = CINZA_FILL;
  linha += 1;

  const linhaResponsavel = linha;
  ws.getCell(`A${linha}`).value = 'Realizado por';
  ws.getCell(`A${linha}`).font = estiloRotulo();
  linha += 1;
  const linhaData = linha;
  ws.getCell(`A${linha}`).value = 'Data';
  ws.getCell(`A${linha}`).font = estiloRotulo();
  linha += 1;
  const linhaHora = linha;
  ws.getCell(`A${linha}`).value = 'Hora';
  ws.getCell(`A${linha}`).font = estiloRotulo();
  linha += 1;

  verificacoes.forEach((verificacao, index) => {
    const col = coluna(index);
    ws.getCell(`${col}${linhaResponsavel}`).value = verificacao.realizadoPor || '';
    ws.getCell(`${col}${linhaData}`).value = verificacao.data || '';
    ws.getCell(`${col}${linhaHora}`).value = verificacao.hora || '';
    [linhaResponsavel, linhaData, linhaHora].forEach((r) => {
      ws.getCell(`${col}${r}`).font = estiloInput();
      ws.getCell(`${col}${r}`).alignment = centro();
    });
  });

  const linhaPrimeiroPeso = linha;
  for (let i = 0; i < 10; i += 1) {
    ws.getCell(`A${linha}`).value = `${i + 1}º peso (g)`;
    ws.getCell(`A${linha}`).font = estiloRotulo();
    verificacoes.forEach((verificacao, colIndex) => {
      const col = coluna(colIndex);
      const cell = ws.getCell(`${col}${linha}`);
      cell.value = verificacao.pesos[i] || null;
      cell.font = estiloInput();
      cell.numFmt = '0.00';
      cell.alignment = centro();
    });
    linha += 1;
  }
  const linhaUltimoPeso = linha - 1;

  const linhaPrimeiroVolume = linha;
  for (let i = 0; i < 10; i += 1) {
    const linhaPeso = linhaPrimeiroPeso + i;
    ws.getCell(`A${linha}`).value = `${i + 1}º volume (mL)`;
    ws.getCell(`A${linha}`).font = estiloRotulo();
    verificacoes.forEach((verificacao, colIndex) => {
      const col = coluna(colIndex);
      const cell = ws.getCell(`${col}${linha}`);
      cell.value = {
        // =(peso-$H$8)/$H$7 da ficha: aqui H8 = $D$8 e H7 = $B$8 (valores do produto)
        formula: `IF(${col}${linhaPeso}="","",IF(OR($B$${linhaEspecificacao}="",$B$${linhaEspecificacao}=0),"",(${col}${linhaPeso}-$D$${linhaEspecificacao})/$B$${linhaEspecificacao}))`,
      };
      cell.font = estiloFormula();
      cell.numFmt = '0.00';
      cell.alignment = centro();
    });
    linha += 1;
  }
  const linhaUltimoVolume = linha - 1;

  ws.getCell(`A${linha}`).value = 'Média (mL)';
  ws.getCell(`A${linha}`).font = { name: 'Arial', size: 9, bold: true };
  verificacoes.forEach((verificacao, colIndex) => {
    const col = coluna(colIndex);
    const cell = ws.getCell(`${col}${linha}`);
    cell.value = { formula: `IFERROR(AVERAGE(${col}${linhaPrimeiroVolume}:${col}${linhaUltimoVolume}),"")` };
    cell.font = { name: 'Arial', size: 10, bold: true };
    cell.numFmt = '0.00';
    cell.alignment = centro();
  });
  const linhaMedia = linha;

  if (qtdCols > 0) {
    const faixa1 = `${coluna(0)}${linhaMedia}:${ultimaColuna}${linhaMedia}`;
    const faixa2 = `${coluna(0)}${linhaPrimeiroVolume}:${ultimaColuna}${linhaUltimoVolume}`;
    ws.addConditionalFormatting({
      ref: `${faixa1} ${faixa2}`,
      rules: [
        { type: 'expression', formulae: [`AND(${coluna(0)}${linhaPrimeiroVolume}<>"",${coluna(0)}${linhaPrimeiroVolume}>=$B$${linhaMinimo},${coluna(0)}${linhaPrimeiroVolume}<=$D$${linhaMaximo})`], style: { fill: VERDE_FILL }, priority: 1 },
        { type: 'expression', formulae: [`AND(${coluna(0)}${linhaPrimeiroVolume}<>"",OR(${coluna(0)}${linhaPrimeiroVolume}<$B$${linhaMinimo},${coluna(0)}${linhaPrimeiroVolume}>$D$${linhaMaximo}))`], style: { fill: VERMELHO_FILL }, priority: 2 },
      ],
    });
  }

  linha += 2;
  ws.getCell(`A${linha}`).value = `Exportado em ${new Date().toLocaleString('pt-BR')} — sistema Cartas de Peso Sobral.`;
  ws.getCell(`A${linha}`).font = { name: 'Arial', size: 8, italic: true, color: { argb: 'FF667085' } };

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: linhaResponsavel - 1 }];

  return wb.xlsx.writeBuffer();
}

module.exports = { gerarPlanilhaControleDensidade };
