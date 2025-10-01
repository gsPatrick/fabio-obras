// src/features/Auth/auth.controller.js
const { User, Profile } = require('../../models'); // Importar Profile para criar o primeiro perfil
const jwt = require('jsonwebtoken');
const logger = require('../../utils/logger');

class AuthController {
  
  // NOVO: Função para registrar um novo usuário
  async register(req, res) {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    try {
      // 1. Verificar se o usuário já existe
      const userExists = await User.findOne({ where: { email } });
      if (userExists) {
        return res.status(409).json({ error: 'Este email já está registrado.' });
      }

      // 2. Criar o usuário (o hook de modelo criptografa a senha)
      const newUser = await User.create({ email, password });
      
      // 3. Criar o primeiro Perfil Padrão
      const newProfile = await Profile.create({ 
          name: 'Perfil Principal', 
          user_id: newUser.id 
      });
      
      logger.info(`[Auth] Novo usuário registrado: ${newUser.email} com Perfil ID: ${newProfile.id}`);

      // 4. Gerar token de autenticação
      const token = jwt.sign({ id: newUser.id }, process.env.JWT_SECRET || 'your-default-secret', {
        expiresIn: '1d', 
      });
      
      // 5. Retornar token e ID do primeiro perfil criado
      res.status(201).json({ 
          message: 'Registro e Perfil criados com sucesso.', 
          token: token,
          profileId: newProfile.id // Retorna o ID do primeiro perfil para o Front-end
      });

    } catch (error) {
      logger.error('[Auth] Erro no registro:', error);
      res.status(500).json({ error: 'Erro interno do servidor durante o registro.' });
    }
  }
  
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

      // Busca o primeiro perfil do usuário para facilitar o login no Front-end
      const defaultProfile = await Profile.findOne({ 
          where: { user_id: user.id }, 
          order: [['id', 'ASC']]
      });

      // Retorna o token e o ID do perfil padrão (se existir)
      res.status(200).json({ 
          message: 'Login bem-sucedido.', 
          token: token,
          profileId: defaultProfile ? defaultProfile.id : null // Retorna o ID do perfil padrão
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