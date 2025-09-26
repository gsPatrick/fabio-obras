// src/features/User/user.controller.js
const { User } = require('../../models');

class UserController {
    // Retorna os dados do usuário logado (útil para o front-end)
    async getMe(req, res) {
        const user = await User.findByPk(req.userId, { attributes: ['id', 'email'] });
        res.status(200).json(user);
    }
    
    // Atualiza o usuário logado
    async updateMe(req, res) {
        const { email, password } = req.body;
        
        try {
            const user = await User.findByPk(req.userId);
            if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

            if (email) user.email = email;
            if (password) user.password = password; // O hook irá criptografar

            await user.save();
            res.status(200).json({ message: 'Credenciais atualizadas com sucesso.' });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao atualizar credenciais.' });
        }
    }
}

module.exports = new UserController();