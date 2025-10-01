const mercadopago = require("mercadopago")

// Garante que o token de acesso do Mercado Pago seja lido do ambiente
mercadopago.configure({
  access_token: process.env.MERCADO_PAGO_TOKEN,
})

module.exports = mercadopago