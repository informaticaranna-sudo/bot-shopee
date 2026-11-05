# Bot de Promoções Shopee (painel + servidor)

## Rodar no seu PC
1. Instale o Node.js 18 ou superior (nodejs.org).
2. Nesta pasta, rode: `node server.js`
3. Abra http://localhost:3000
4. Abra "Conexão com a Shopee", cole o AppID e o Secret e salve.
5. Cole o link de um produto: nome, De e Por são preenchidos sozinhos.

## Hospedar (Render, Railway, VPS...)
- Comando de início: `node server.js`
- Defina as variáveis de ambiente (recomendado em vez de salvar pelo painel):
  - `SHOPEE_APP_ID` e `SHOPEE_SECRET`
  - `PANEL_PASSWORD`: senha para entrar no painel (use sempre que o painel estiver na internet)
- Em hospedagens gratuitas o disco costuma ser apagado ao reiniciar, então use as variáveis acima.

## Se a busca der erro
O painel mostra a mensagem que a Shopee devolveu. Se a mensagem citar um campo
inexistente, ajuste a consulta GraphQL na função `buscarProduto` do `server.js`.
