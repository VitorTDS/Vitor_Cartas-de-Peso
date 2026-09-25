# Análise técnica — RQ 6308 Rev. 03

Arquivo analisado: `RQ_6308_REV_03_-_Ficha_de_controle_em_proc._de_vol._pela_dens._de_suplemento_liquido.xlsm`

Módulo VBA analisado: `modFicha_RQ6308.bas`

## Resumo do inventário

- Aba: `Volume pela Densidade (2)`
- Área utilizada: `A1:R54`
- Área de impressão: `A1:Q53`
- Fórmulas armazenadas: 162
- Regras de formatação condicional: 5
- Gráfico: 1, alimentado pelas médias `D28:P28`
- Verificações durante o processo: 13 colunas, de `D` a `P`
- Pesagens por verificação: 10
- A planilha está protegida e não possui regras de validação de dados.

## Campos de entrada

| Célula/faixa | Informação |
|---|---|
| `A6` | Produto |
| `E6` | Lote |
| `F6` | Volume declarado em ml |
| `J6` | Variação permitida em % |
| `O6` | Tag da máquina |
| `N8` | Linha |
| `O8` | Tag da balança |
| `B15:B24` | Dez pesos de embalagem — medição 1 |
| `C15:C24` | Dez pesos de embalagem — medição 2 |
| `B26` e `C26` | Duas medições de densidade |
| `D11:P11` | Responsável por cada verificação |
| `D12:P12` | Data de cada verificação |
| `D13:P13` | Hora de cada verificação |
| `D15:P24` | Dez pesos brutos em cada uma das 13 verificações |
| `E52` | Impresso por |
| `N52` | Conferido por |

## Fórmulas encontradas

### Parâmetros efetivamente usados

| Célula | Fórmula | Função |
|---|---|---|
| `H7` | `=C26` | Usa a segunda medição de densidade nos cálculos |
| `L7` | `=F6` | Define o limite mínimo como o volume declarado |
| `H8` | `=C25` | Usa a média da segunda medição do peso da embalagem |
| `L8` | `=F6+(J6*F6/100)` | Define o limite máximo com a variação permitida |

Observação importante: a planilha não calcula a média entre as duas densidades ou entre os dois resultados de embalagem. Ela compara os dois valores visualmente, mas usa somente a segunda medição (`C26` e `C25`) no cálculo do volume.

### Médias do peso da embalagem

| Célula | Fórmula |
|---|---|
| `B25` | `=SUM(B15:B24)/10` |
| `C25` | `=SUM(C15:C24)/10` |

Cada resultado é a média aritmética fixa de dez pesagens.

### Cálculo de cada volume

O intervalo `D31:P40` contém 130 fórmulas. O padrão é:

```text
volume da amostra = (peso bruto - peso médio da embalagem) / densidade
```

Exemplo da primeira amostra da primeira verificação (`D31`):

```excel
=(D15-$H$8)/$H$7
```

A referência ao peso bruto varia conforme coluna e linha; `$H$8` e `$H$7` permanecem fixos. Portanto, a implementação equivalente é:

```javascript
volumeMl = (pesoBrutoG - pesoEmbalagemG) / densidadeGPorMl;
```

O cálculo só deve ocorrer quando a densidade for maior que zero e todos os valores necessários estiverem preenchidos.

### Média por verificação

O intervalo `D28:P28` contém a média dos dez volumes calculados em cada verificação:

```excel
=AVERAGE(D31:D40)
```

A fórmula é repetida, deslocando a coluna até `P28`.

### Horários do gráfico

O intervalo `D30:P30` replica os horários digitados em `D13:P13`. Exemplo:

```excel
=D13
```

O gráfico usa as médias de volume `D28:P28`. A linha 30 fornece os horários que devem identificar os pontos no sistema.

## Critérios de conformidade

Os limites são:

```text
limite mínimo = volume declarado
limite máximo = volume declarado × (1 + variação permitida / 100)
```

Para cada volume individual e para cada média:

- entre o mínimo e o máximo, inclusive: verde;
- de zero até abaixo do mínimo: vermelho;
- acima do máximo: vermelho;
- sem densidade válida ou sem dados completos: não calcular e exibir vazio ou traço.

As faixas submetidas a essas regras são `D28:P28` e `D31:P40`.

## Comparações das medições iniciais

- `B25:C25`: quando as duas médias do peso da embalagem são diferentes, ambas aparecem em vermelho.
- `B26:C26`: quando as duas densidades são diferentes, ambas aparecem em vermelho.

A planilha não contém tolerância numérica para essas comparações: qualquer diferença dispara o destaque. No sistema, é recomendável comparar os valores já arredondados à precisão exibida, evitando diferenças causadas apenas por ponto flutuante.

## Comportamento das macros VBA

O módulo executa quatro funções principais:

1. Imprimir a aba ativa.
2. Salvar uma cópia em formato XLSM.
3. Exportar a ficha em PDF, compondo o nome com produto (`A6`) e lote (`E6`).
4. Duplicar a ficha para uma nova aba, preservando fórmulas, formatação e proteção e limpando somente os campos de entrada desbloqueados.

Os campos limpos na duplicação são `A6`, `E6`, `J6`, `O6`, `N8`, `O8`, `B11:P24`, `E52` e `N52`. O volume declarado em `F6` e as células calculadas são preservados.

## Diferenças em relação ao sistema atual

O cálculo atual do sistema usa a média dos pesos brutos dividida diretamente pela densidade declarada. Isso não reproduz a planilha porque não desconta a tara da embalagem antes da divisão.

| Tema | Planilha | Sistema atual | Alteração necessária |
|---|---|---|---|
| Volume individual | `(peso bruto - tara média) / densidade` | `média do peso bruto / densidade` | Descontar a tara em cada amostra |
| Média da verificação | Média de dez volumes individuais | Derivada diretamente da média dos pesos | Calcular os dez volumes e depois a média |
| Tara | Duas séries de dez pesagens; usa a média da segunda | Um único campo | Acrescentar as duas séries ou definir migração controlada |
| Densidade | Duas medições; usa a segunda | Um único valor declarado | Registrar as duas medições e sinalizar divergência |
| Conformidade | Compara volumes com mínimo e máximo | Também avalia densidade em faixa percentual | Adequar a regra ao volume da planilha |
| Evolução | Gráfico com 13 médias e horários | Sem equivalente direto | Criar série temporal das verificações |

## Modelo recomendado para implementação

```text
preparação
  pesosEmbalagem1[10]
  pesosEmbalagem2[10]
  mediaEmbalagem1
  mediaEmbalagem2          <- valor aplicado ao cálculo
  densidade1
  densidade2               <- valor aplicado ao cálculo

verificação[13]
  responsável
  data
  hora
  pesosBrutos[10]
  volumesCalculados[10]
  volumeMedio
  status
```

Sequência de cálculo:

```text
mediaEmbalagem1 = soma(pesosEmbalagem1) / 10
mediaEmbalagem2 = soma(pesosEmbalagem2) / 10
limiteMinimo    = volumeDeclarado
limiteMaximo    = volumeDeclarado × (1 + variacaoPercentual / 100)
volume[i]       = (pesoBruto[i] - mediaEmbalagem2) / densidade2
volumeMedio     = soma(volumes válidos) / quantidade de volumes válidos
```

Para reprodução estritamente fiel, a média da verificação deve ser mostrada apenas depois das dez amostras válidas, pois a planilha divide as médias de embalagem por 10 e espera dez valores por verificação.

## Decisões funcionais antes da alteração da interface

Há duas possibilidades:

1. Fidelidade integral: incluir as duas séries de tara, duas densidades, dez amostras e treze verificações, usando sempre a segunda medição como a planilha.
2. Fluxo simplificado: manter uma tara e uma densidade no sistema, mas aplicar corretamente `(peso bruto - tara) / densidade`. Essa opção corrige o resultado, porém não reproduz os controles de repetibilidade do documento oficial.

A opção recomendada para rastreabilidade é a fidelidade integral.
