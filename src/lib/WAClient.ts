import { MessageType, Mimetype, WAConnection as Base, WAMessage } from '@adiwajshing/baileys'
import chalk from 'chalk'
import qrImage from 'qr-image'
import { existsSync, readdirSync, statSync } from 'fs'
import moment from 'moment'
import { join } from 'path'
import { IConfig, IExtendedGroupMetadata, ISimplifiedMessage } from '../typings'

export default class WAClient extends Base {
    constructor(public config: IConfig) {
        super()
        this.browserDescription[0] = 'WhatsApp-Botto-Void'
        this.logger.level = 'fatal'
        const sessionFile = `./${this.config.session}_session.json`

        existsSync(sessionFile) && this.loadAuthInfo(sessionFile)
        this.on('chat-update', (update) => {
            if (!update.messages) return void null
            const messages = update.messages.all()
            if (!messages[0]) return void null
            this.emitNewMessage(this.simplifyMessage(messages[0]))
        })

        this.on('qr', (qr) => {
            this.QR = qrImage.imageSync(qr)
        })

        this.on('CB:action,,call', async (json) => this.emit('call', json[2][0][1].from))
    }

    QR!: Buffer

    emitNewMessage = async (M: Promise<ISimplifiedMessage>): Promise<void> => void this.emit('new-message', await M)

    supportedMediaMessages = [MessageType.image, MessageType.video]

    simplifyMessage = async (M: WAMessage): Promise<ISimplifiedMessage> => {
        const jid = M.key.remoteJid || ''
        const chat = jid.endsWith('g.us') ? 'group' : 'dm'
        const type = (Object.keys(M.message || {})[0] || '') as MessageType
        const user = chat === 'group' ? M.participant : jid
        const info = this.getContact(user)
        const groupMetadata: IExtendedGroupMetadata | null = chat === 'group' ? await this.groupMetadata(jid) : null
        if (groupMetadata)
            groupMetadata.admins = groupMetadata.participants.filter((user) => user.isAdmin).map((user) => user.jid)
        const sender = {
            jid: user,
            username: info.notify || info.vname || info.name || 'User',
            isAdmin: groupMetadata && groupMetadata.admins ? groupMetadata.admins.includes(user) : false
        }
        const content: string | null =
            type === MessageType.text && M.message?.conversation
                ? M.message.conversation
                : this.supportedMediaMessages.includes(type)
                ? this.supportedMediaMessages
                      .map((type) => M.message?.[type as MessageType.image | MessageType.video]?.caption)
                      .filter((caption) => caption)[0] || ''
                : type === MessageType.extendedText && M.message?.extendedTextMessage?.text
                ? M.message?.extendedTextMessage.text
                : null
        const quoted: ISimplifiedMessage['quoted'] = {}
        quoted.message = M?.message?.[type as MessageType.extendedText]?.contextInfo?.quotedMessage
            ? JSON.parse(JSON.stringify(M).replace('quotedM', 'm')).message?.[type as MessageType.extendedText]
                  .contextInfo
            : null
        quoted.sender = M.message?.[type as MessageType.extendedText]?.contextInfo?.participant
        return {
            type,
            content,
            chat,
            sender,
            quoted,
            args: content?.split(' ') || [],
            reply: async (
                content: string | Buffer,
                type?: MessageType,
                mime?: Mimetype,
                mention?: string[],
                caption?: string
            ) =>
                await this.sendMessage(jid, content, type || MessageType.text, {
                    quoted: M,
                    caption: caption,
                    mimetype: mime,
                    contextInfo: { mentionedJid: mention }
                }),
            mentioned: this.getMentionedUsers(M, type),
            from: jid,
            groupMetadata,
            WAMessage: M
        }
    }

    log = (text: string, error?: boolean): void => {
        console.log(
            chalk[error ? 'red' : 'green']('[VOID]'),
            chalk.blue(moment(Date.now() * 1000).format('DD/MM HH:mm:ss')),
            chalk.yellowBright(text)
        )
    }

    getMentionedUsers = (M: WAMessage, type: string): string[] => {
        const notEmpty = <TValue>(value: TValue | null | undefined): value is TValue =>
            value !== null && value !== undefined
        const array = M?.message?.[type as MessageType.extendedText]?.contextInfo?.mentionedJid
            ? M?.message[type as MessageType.extendedText]?.contextInfo?.mentionedJid
            : []
        return (array || []).filter(notEmpty)
    }

    //eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    getContact = (jid: string) => {
        return this.contacts[jid] || {}
    }

    util = {
        readdirRecursive: (directory: string): string[] => {
            const results: string[] = []

            const read = (path: string): void => {
                const files = readdirSync(path)

                for (const file of files) {
                    const dir = join(path, file)
                    if (statSync(dir).isDirectory()) read(dir)
                    else results.push(dir)
                }
            }
            read(directory)
            return results
        },

        capitalize: (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`
    }
}
