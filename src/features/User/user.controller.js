// src/features/User/user.controller.js

const { User, Subscription } = require('../../models');
const subscriptionService = require('../../services/subscriptionService');

class UserController {
    // Retorna os dados do usuário logado, AGORA INCLUINDO A ASSINATURA
    async getMe(req, res) {
        const user = await User.findByPk(req.userId, {
            attributes: ['id', 'email', 'whatsapp_phone'],
            // Inclui os dados da assinatura na resposta
            include: [{
                model: Subscription,
                as: 'subscription',
                attributes: ['status', 'profile_limit', 'expires_at']
            }]
        });

        // O admin principal não tem uma assinatura no DB, então criamos um objeto mock
        if (user && user.email === 'fabio@gmail.com' && !user.subscription) {
            user.setDataValue('subscription', {
                status: 'active',
                profile_limit: 999, // Limite "infinito" para o admin
                expires_at: null
            });
        }

        res.status(200).json(user);
    }
    
    // Atualiza o usuário logado
    async updateMe(req, res) {
        const { email, password, whatsappPhone } = req.body;
        
        try {
            const user = await User.findByPk(req.userId);
            if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

            if (email) user.email = email;
            if (password) user.password = password; // O hook irá criptografar
            if (whatsappPhone) user.whatsapp_phone = whatsappPhone.replace(/[^0-9]/g, ''); // Limpa e salva o novo número

            await user.save();
            res.status(200).json({ message: 'Credenciais atualizadas com sucesso.' });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao atualizar credenciais.' });
        }
    }
    
    // Verifica o status de assinatura do usuário logado
    async getSubscriptionStatus(req, res) {
        try {
            const userId = req.userId;
            const status = await subscriptionService.getSubscriptionStatus(userId);
            res.status(200).json(status);
        } catch (error) {
            res.status(500).json({ status: 'error', message: error.message });
        }
    }
}

module.exports = new UserController();