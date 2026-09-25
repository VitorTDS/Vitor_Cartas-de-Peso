function numero(valor, fallback = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : fallback;
}

function arredondar(valor, casas = 2) {
  return Math.round((numero(valor) + Number.EPSILON) * 10 ** casas) / 10 ** casas;
}

function calcularAmostra(pesoBruto, taraEmbalagem, densidade, limites) {
  const bruto = numero(pesoBruto);
  const tara = numero(taraEmbalagem);
  const dens = numero(densidade);
  const liquido = bruto - tara;
  const volume = dens > 0 ? liquido / dens : 0;
  const volumeFora = volume < numero(limites.volumeMinimo) || volume > numero(limites.volumeMaximo);
  const brutoFora = bruto < numero(limites.pesoBrutoMinimo) || bruto > numero(limites.pesoBrutoMaximo);

  return {
    pesoBruto: arredondar(bruto, 3),
    pesoLiquido: arredondar(liquido, 3),
    volumeMl: arredondar(volume, 3),
    aprovado: !volumeFora && !brutoFora,
    motivos: [
      volume < numero(limites.volumeMinimo) ? 'Volume inferior ao mínimo' : null,
      volume > numero(limites.volumeMaximo) ? 'Volume superior ao máximo' : null,
      bruto < numero(limites.pesoBrutoMinimo) ? 'Peso bruto inferior ao mínimo' : null,
      bruto > numero(limites.pesoBrutoMaximo) ? 'Peso bruto superior ao máximo' : null,
    ].filter(Boolean),
  };
}

function calcularColeta({ taraEmbalagem, pesosBrutos, densidade, limites }) {
  const amostras = (pesosBrutos || [])
    .filter((p) => p !== null && p !== undefined && p !== '')
    .map((peso) => calcularAmostra(peso, taraEmbalagem, densidade, limites));

  const total = amostras.length;
  const somaBrutos = amostras.reduce((acc, item) => acc + item.pesoBruto, 0);
  const somaVolumes = amostras.reduce((acc, item) => acc + item.volumeMl, 0);
  const volumes = amostras.map((item) => item.volumeMl);
  const fora = amostras.filter((item) => !item.aprovado).length;

  return {
    amostras,
    mediaPesosBrutos: total ? arredondar(somaBrutos / total, 3) : 0,
    mediaVolumes: total ? arredondar(somaVolumes / total, 3) : 0,
    menorVolume: total ? arredondar(Math.min(...volumes), 3) : 0,
    maiorVolume: total ? arredondar(Math.max(...volumes), 3) : 0,
    totalAmostras: total,
    amostrasFora: fora,
    status: fora === 0 && total > 0 ? 'aprovado' : 'reprovado',
  };
}

function calcularResumoCarta(carta, coletas) {
  const todas = coletas.flatMap((coleta) => coleta.resultado.amostras);
  const volumes = todas.map((amostra) => amostra.volumeMl);
  const fora = todas.filter((amostra) => !amostra.aprovado).length;
  const media = volumes.length ? volumes.reduce((acc, v) => acc + v, 0) / volumes.length : 0;

  return {
    produto: carta.produtoNome,
    lote: carta.lote,
    totalColetas: coletas.length,
    totalAmostras: todas.length,
    volumeMedioGeral: arredondar(media, 3),
    menorVolume: volumes.length ? arredondar(Math.min(...volumes), 3) : 0,
    maiorVolume: volumes.length ? arredondar(Math.max(...volumes), 3) : 0,
    amostrasAprovadas: todas.length - fora,
    amostrasForaLimite: fora,
    statusFinalSugerido: fora === 0 ? 'aprovado' : fora <= Math.max(1, Math.floor(todas.length * 0.05)) ? 'aprovado_com_ressalva' : 'reprovado',
  };
}

module.exports = {
  arredondar,
  calcularAmostra,
  calcularColeta,
  calcularResumoCarta,
};
