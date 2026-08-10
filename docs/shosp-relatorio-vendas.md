# Relatório de Vendas Realizadas (Shosp) — layout e como o CRM lê

Export manual do painel do Shosp (Financeiro → Vendas realizadas). É a única forma de trazer o
financeiro da clínica: a API que integramos (`crm-shosp`) só tem agenda e paciente, não tem
endpoint de dinheiro.

Quem lê: [`src/services/shospVendas.ts`](../src/services/shospVendas.ts) →
[`src/services/conciliacaoShosp.ts`](../src/services/conciliacaoShosp.ts) → tela `/conciliacao-shosp`.

Arquivo de referência deste documento: export de julho/2026, 306 linhas, 300 vendas,
R$ 1.567.726,00.

## O arquivo

- CSV separado por `;`, **UTF-8 sem BOM**, uma linha de cabeçalho, sem título antes.
- Nome sai no padrão `Relatorio-de-Vendas-Realizadas-<email>-<MMDDHHMMSS>.csv`.
- Decimal com **ponto** (`600.00`), data **dd/mm/aaaa**, hora separada em outra coluna.

### Colunas

| # | Coluna | O que é | Uso no CRM |
|---|---|---|---|
| 1 | `Cod` | código da venda | **identidade** — agrupa as linhas da mesma venda |
| 2 | `Data` | data da venda | data do recebimento |
| 3 | `Hora` | hora da venda | — |
| 4 | `Paciente` | nome | casa com a descrição do lançamento no banco |
| 5 | `CPF` | só dígitos, pode vir vazio | ficha |
| 6 | `Unidade` | unidade da clínica | — |
| 7 | `Plano de Saúde` | `PARTICULAR` ou vazio | — |
| 8 | `Caixa` | **conta em que o dinheiro entrou** | decide se a venda pode ser cobrada do extrato |
| 9 | `Prestador` | profissional, vazio em boa parte | ficha |
| 10 | `Servico` | procedimento | lista de serviços da venda |
| 11 | `Qtd Serv.` | quantidade do serviço (sempre 1 no arquivo de referência) | — |
| 12 | `V. Serv` | valor **daquele serviço** | — |
| 13 | `N.F.A` | nota fiscal, sempre vazio | — |
| 14 | `F. Pagam.` | **código** da forma + parcelas | forma de pagamento |
| 15 | `Bandeira` | bandeira do cartão | — |
| 16 | `Terceiro` | sempre vazio | — |
| 17 | `Status` | situação em letra (`A`) | conferência |
| 18 | `V. Total` | total **da venda** | — |
| 19 | `V. Rec.` | o que o paciente entregou | — |
| 20 | `V. Troco` | troco | — |
| 21 | `V. Desc.` | desconto | — |
| 22 | `V. Cobr.` | **valor cobrado da venda** | é o valor que o CRM usa |

## As três pegadinhas

### 1. Uma linha por SERVIÇO, não por venda

Venda com 3 procedimentos vem em 3 linhas com o mesmo `Cod`, e `V. Total` / `V. Cobr.` vêm
**repetidos em cada linha**. Somar linha a linha conta a mesma venda mais de uma vez:

```
Cod 10530  21/07  APLICAÇÃO DE VITAMINA B12   V.Serv 300,00   V.Cobr 1.700,00
Cod 10530  21/07  APLICAÇÃO DE VITAMINA D     V.Serv 300,00   V.Cobr 1.700,00
Cod 10530  21/07  INFUSÃO DE FERINJECT        V.Serv 1.100,00 V.Cobr 1.700,00
```

No arquivo de referência: somando por linha dá R$ 1.574.921,00; o certo é R$ 1.567.726,00 —
**R$ 7.195 de faturamento que não existe**. O parser agrupa por `Cod` (exigindo mesma data,
mesmo valor e mesma forma) e guarda os serviços numa lista.

Conferência que fecha: `soma de V. Serv por linha` == `soma de V. Cobr. por venda`.

### 2. Forma de pagamento é sigla, com a parcela colada

| Código | Forma |
|---|---|
| `PX` | PIX |
| `CC` | cartão de crédito (`CC 10x` = 10 parcelas) |
| `CD` | cartão de débito |
| `DN` | dinheiro |
| `DB` | lido como depósito bancário — ver ressalva abaixo |

Não existe coluna de parcelas: a parcela está no texto (`CC 10x`). E o pagamento dividido vem
com barra — `CC 6x/PX`, `CC 5x/CD` — **sem dizer quanto foi em cada forma**. Por isso venda
dividida sai do casamento automático e vai pra lista de conferência na mão (8 casos, R$ 41.870
em julho/2026).

> `DB` apareceu uma vez só, R$ 37.800 no caixa do Itaú. Como `CD` já é o cartão de débito neste
> mesmo relatório, foi lido como depósito bancário. Se um dia significar outra coisa, o efeito é
> a venda ser procurada 1 pra 1 no extrato — ela aparece como divergência na tela, não some.

### 3. `Caixa` diz se a venda pode ser cobrada do extrato

Em julho/2026:

| Caixa | Vendas | Valor |
|---|---:|---:|
| ITAU MARINGA - PIX/CARTÃO/TED | 264 | R$ 1.378.066,00 |
| DINHEIRO | 14 | R$ 145.260,00 |
| LONDRINA | 11 | R$ 17.850,00 |
| GRUPO INGÁ - ANESTESISTAS | 7 | R$ 16.550,00 |
| CONTA DRA. THAYLA - ANESTESISTA | 4 | R$ 10.000,00 |

Venda lançada no caixa de um anestesista ou de outra praça **nunca vai estar no extrato do
Itaú**. Sem tratar isso, 14 PIX viravam "não caiu no banco" com gravidade alta — R$ 26.550 de
alarme falso. Na tela, em *Regras*, cada caixa tem um checkbox: desmarque o que não passa pelo
extrato que você subiu. Dinheiro não precisa desmarcar (tem bloco próprio, vendido × depositado).

## Outras armadilhas já tratadas

- **UTF-8**: sem BOM, o SheetJS decide sozinho que os bytes são latin-1 e "VINÍCIUS" vira
  "VINÃCIUS" — aí o nome não casa mais com a descrição do lançamento no banco. CSV é lido
  como **texto** (`file.text()`), não como bytes.
- **Data americana**: `XLSX.read` sem `raw: true` lê `10/07/2026` como 7 de outubro, e
  `25/12/2026` deixa como string. Metade da coluna desloca de mês, calado. Quem converte é o
  `toISODate`.
- **`V. Rec.` ≠ `V. Cobr.`** em 10 linhas: cartão parcelado arredonda a parcela e sobra
  centavo (R$ 29.000,04 numa venda de R$ 29.000,00). O valor usado é `V. Cobr.`.
- **`Status`**: só apareceu `A`. O parser não chuta o que outras letras significam — conta cada
  situação e a tela mostra. Sumir com venda por palpite é pior que mostrar situação estranha.
- **`Cod` × `Unidade`**: o apelido `id` casava por dentro de "un-ID-ade" e roubava a coluna do
  documento. `pickCol` agora só faz casamento parcial com apelido de 4 letras ou mais.

## Como conferir um export novo em 1 minuto

```bash
f="Relatorio-de-Vendas-Realizadas-....csv"
# vendas de verdade (por Cod) x linhas
awk -F';' 'NR>1{print $1}' "$f" | sort -u | wc -l
# total certo: soma de V. Serv por linha
awk -F';' 'NR>1{s+=$12} END{printf "%.2f\n", s}' "$f"
# formas e caixas que apareceram
awk -F';' 'NR>1{print $14}' "$f" | sort | uniq -c | sort -rn
awk -F';' 'NR>1{print $8}'  "$f" | sort | uniq -c | sort -rn
```

Se aparecer sigla de forma fora da tabela acima ou caixa novo, é caso de atualizar
`CODIGO_FORMA` em `src/services/shospVendas.ts` — ou pelo menos de olhar a tela antes de
confiar no número.
