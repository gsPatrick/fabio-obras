// src/features/Auth/auth.controller.js
const { User, Profile } = require('../../models'); 
const jwt = require('jsonwebtoken');
const logger = require('../../utils/logger');

class AuthController {
  
  async register(req, res) {
    const { email, password, whatsappPhone } = req.body;
    if (!email || !password || !whatsappPhone) {
      return res.status(400).json({ error: 'Email, senha e número de WhatsApp são obrigatórios.' });
    }
    try {
      const userExists = await User.findOne({ where: { email } });
      if (userExists) {
        return res.status(409).json({ error: 'Este email já está registrado.' });
      }
      const newUser = await User.create({ 
          email, 
          password,
          whatsapp_phone: whatsappPhone,
          status: 'active' // <<< MUDANÇA: Cadastro via web já é ativo
      });
      const newProfile = await Profile.create({ name: 'Perfil Principal', user_id: newUser.id });
      logger.info(`[Auth] Novo usuário registrado via web: ${newUser.email}`);
      const token = jwt.sign({ id: newUser.id }, process.env.JWT_SECRET || 'your-default-secret', { expiresIn: '1d' });
      res.status(201).json({ message: 'Registro e Perfil criados com sucesso.', token: token, profileId: newProfile.id });
    } catch (error) {
      logger.error('[Auth] Erro no registro:', error);
      res.status(500).json({ error: 'Erro interno do servidor durante o registro.' });
    }
  }

  // <<< NOVO MÉTODO >>>
  async completeRegistration(req, res) {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token e senha são obrigatórios.' });
    }

    try {
      // 1. Verifica o token de finalização
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-default-secret');
      const userId = decoded.id;

      const user = await User.findByPk(userId);
      if (!user || user.status !== 'pending') {
        return res.status(401).json({ error: 'Token inválido ou usuário já ativo.' });
      }

      // 2. Atualiza o usuário com a senha e o status 'active'
      user.password = password;
      user.status = 'active';
      await user.save();

      // 3. Cria o primeiro perfil para ele
      const newProfile = await Profile.create({ name: 'Perfil Principal', user_id: user.id });
      logger.info(`[Auth] Usuário ${user.email} finalizou o cadastro via link mágico.`);

      // 4. Gera um novo token de LOGIN para o frontend
      const loginToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'your-default-secret', {
        expiresIn: '1d',
      });

      // 5. Retorna o token de login para o frontend autenticar o usuário e redirecionar para o pagamento
      res.status(200).json({
        message: 'Cadastro finalizado com sucesso!',
        token: loginToken,
        profileId: newProfile.id,
        user: { id: user.id, email: user.email }
      });
    } catch (error) {
      logger.error('[Auth] Erro ao finalizar cadastro:', error);
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Link inválido ou expirado. Por favor, solicite um novo.' });
      }
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }
  
  async login(req, res) {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }
    try {
      const user = await User.findOne({ where: { email } });
      // <<< MUDANÇA: Verifica se usuário está ativo
      if (!user || !(await user.checkPassword(password)) || user.status !== 'active') {
        return res.status(401).json({ error: 'Credenciais inválidas ou cadastro pendente.' });
      }
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'your-default-secret', { expiresIn: '1d' });
      const defaultProfile = await Profile.findOne({ where: { user_id: user.id }, order: [['id', 'ASC']] });
      res.status(200).json({ message: 'Login bem-sucedido.', token: token, profileId: defaultProfile ? defaultProfile.id : null });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async logout(req, res) {
    res.status(200).json({ message: 'Logout bem-sucedido.' });
  }
}

module.exports = new AuthController();