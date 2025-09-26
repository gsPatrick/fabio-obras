// src/features/Auth/auth.controller.js
const { User } = require('../../models');
const jwt = require('jsonwebtoken');

class AuthController {
  async login(req, res) {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    try {
      const user = await User.findOne({ where: { email } });
      if (!user || !(await user.checkPassword(password))) {
        return res.status(401).json({ error: 'Credenciais inválidas.' });
      }

      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'your-default-secret', {
        expiresIn: '1d', // Token expira em 1 dia
      });

      // Envia o token em um cookie httpOnly, que é mais seguro
  res.status(200).json({ 
  message: 'Login bem-sucedido.', 
  token: token 
});

    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async logout(req, res) {
    res.cookie('token', '', {
        httpOnly: true,
        expires: new Date(0), // Expira o cookie
        path: '/',
    });
    res.status(200).json({ message: 'Logout bem-sucedido.' });
  }
}

module.exports = new AuthController();