const discord = require('discord.js')
const bot = require('../../index')
const client = bot.client
const config = bot.config
const log = bot.errorLog.log
const l = bot.language
const storage = bot.storage
const permsChecker = require("../utils/permisssionChecker")

const pendingDelete = []

/**
 * 
 * @param {discord.GuildMember} member
 * @param {discord.TextChannel} channel
 * @param {String} prefix
 * @param {"delete"|"close"|"deletenotranscript"} mode
 * @param {Boolean} nomessage
 * @param {String} reason only when closing, not when deleting!
 */
exports.closeManager = async (member,channel,prefix,mode,reason,nomessage) => {
    const guild = channel.guild
    const user = member.user
    const chalk = await (await import("chalk")).default

    const newReason = reason ? reason : l.messages.none

    //start code

    //FIX CHANNEL COULD BE CLOSED AFTER DELETE:
    if (pendingDelete.includes(channel.id)) return false

    /**@type {String}*/
    const channelname = channel.name
    const ticketOpenerChannelName = channelname.split(prefix)[1]

    //get user that opened the ticket
    var getuserID = storage.get("userFromChannel",channel.id)
    try {
        var ticketOpener = client.users.cache.find(u => u.id === getuserID)
        var isDatabaseError = false
    }catch{var isDatabaseError = true}

    if (!ticketOpener){
        console.log(chalk.red("[database error]"),"something went wrong when getting the data in the database.\nNo panic, this error fixes itself!")
        var isDatabaseError = true
    }

    var enableTranscript = true
    var deleteRequired = false

    if (mode == "delete" || mode == "deletenotranscript"){
        //delete
        //check perms
        if (!guild) return
        if (!permsChecker.command(user.id,guild.id)){
            permsChecker.sendUserNoPerms(user)
            return
        }

        //start delete proccess
        deleteRequired = true
        if (!nomessage){
            await channel.send({content:"**"+l.messages.gettingdeleted+"**"})
        }
        log("system","deleted a ticket",[{key:"user",value:user.tag},{key:"ticket",value:channel.name}])
        pendingDelete.push(channel.id)

        if (!isDatabaseError) storage.set("amountOfUserTickets",getuserID,Number(storage.get("amountOfUserTickets",getuserID)) - 1)
        storage.delete("userFromChannel",channel.id)
        storage.delete("claimData",channel.id)
        storage.delete("autocloseTickets",channel.id)
        if (Number(storage.get("amountOfUserTickets",getuserID)) < 0) storage.set("amountOfUserTickets",getuserID,0)

        //getID & send DM & send api event

        const hiddendata = bot.hiddenData.readHiddenData(channel.id)
        if (hiddendata.length < 1) return channel.send({embeds:[bot.errorLog.notInATicket]})
        const ticketId = hiddendata.find(d => d.key == "type").value
        const ticketData = require("../utils/configParser").getTicketById(ticketId,true)

        require("../api/modules/events").onTicketDelete(user,channel,guild,new Date(),{name:channel.name,status:"deleted",ticketOptions:ticketData})

        hiddendata.push({key:"pendingdelete",value:"true"})
        bot.hiddenData.writeHiddenData(channel.id,hiddendata)

    }else if (mode == "close"){
        //close
        //check perms
        if (config.system.closeMode == "adminonly"){
            if (!guild) return
            if (!permsChecker.command(user.id,guild.id)){
                permsChecker.sendUserNoPerms(user)
                return
            }
        }

        //set new permissions
        var permissionArray = []
        const pfb = discord.PermissionFlagsBits

        if (!isDatabaseError) permissionArray.push({
            id:ticketOpener,
            type:"member",
            allow:[pfb.ViewChannel],
            deny:[pfb.AddReactions,pfb.AttachFiles,pfb.EmbedLinks,pfb.SendMessages]
        })

        permissionArray.push({
            id:guild.roles.everyone,
            type:"role",
            deny:[pfb.AddReactions,pfb.AttachFiles,pfb.EmbedLinks,pfb.SendMessages,pfb.ViewChannel]
        })

        //add main adminroles
        config.adminRoles.forEach((role,index) => {
            try {
                const adminrole = guild.roles.cache.find(r => r.id == role)
                if (!adminrole) return

                permissionArray.push({
                    id:adminrole,
                    type:"role",
                    allow:[pfb.AddReactions,pfb.AttachFiles,pfb.EmbedLinks,pfb.SendMessages,pfb.ViewChannel],
                    deny:[]
                })
            }catch{
                log("system","invalid role! At 'config.json => main_adminroles:"+index)
            }
        })

        //ticketinfo error
        const ticketInfoError = bot.errorLog.serverError("Unable to detect ticket information.\n*(First message that this bot sends)*\n\n__**Possible reasons:**__\n- you unpinned the first message\n- the first message is deleted\n- it has been unpinned & repinned after another message has been pinned.\n\n__**Possible solutions:**__\n- unpin all messages in this channel & repin the first message that this bot sent.\nIf this doesn't work, just delete the ticket manually!")

        //add ticket adminroles

        const hiddendata = bot.hiddenData.readHiddenData(channel.id)
        if (hiddendata.length < 1) return channel.send({embeds:[bot.errorLog.notInATicket]})
        const ticketId = hiddendata.find(d => d.key == "type").value
        const ticketData = require("../utils/configParser").getTicketById(ticketId,true)

        if (!ticketData) return
        if (ticketData.closedCategory.enable){
            /**@type {discord.CategoryChannel} */
            const category = guild.channels.cache.find(c => c.id == ticketData.closedCategory.id && c.type == discord.ChannelType.GuildCategory)
            try {
                channel.setParent(category)
            }catch{
                bot.errorLog.log("system","failed to move channel to new category!")
            }
        }

        ticketData.adminroles.forEach((role,index) => {
            if (!config.adminRoles.includes(role)){
                try {
                    const adminrole = guild.roles.cache.find(r => r.id == role)
                    if (!adminrole) return
                
                    permissionArray.push({
                        id:adminrole,
                        type:"role",
                        allow:[pfb.AddReactions,pfb.ViewChannel,pfb.AttachFiles,pfb.EmbedLinks,pfb.SendMessages],
                        deny:[]
                    })
                }catch{
                    log("system","invalid role! At 'config.json => options/ticket/...:"+index)
                }
            }
        })

        channel.permissionOverwrites.set(permissionArray)

        if (!nomessage){
            //message 
            const embed = new discord.EmbedBuilder()
                .setColor(config.color)
                .setTitle(":lock: "+l.commands.closeTitle+" :lock:")
                .setDescription(l.messages.closedDescription)
            channel.send({embeds:[embed],components:[bot.buttons.close.closeCommandRow]})
        }

        log("system","closed a ticket",[{key:"user",value:user.tag},{key:"ticket",value:channel.name}])
        

        //send api event
        require("../api/modules/events").onTicketClose(user,channel,guild,new Date(),{name:channel.name,status:"closed",ticketOptions:ticketData},newReason)
    }

    /**
     * 
     * @param {discord.TextChannel} channel 
     * @param {Number} limit 
     * @returns 
     */
    const getmessages = async (channel,limit) => {
        const final = []
        var lastId = ""
    
        while (true) {
            const options = {limit:100}
            if (lastId) options.before = lastId
    
            const messages = await channel.messages.fetch(options)
            messages.forEach(msg => {final.push(msg)})
            lastId = messages.last().id
    
            if (messages.size != 100 || final >= limit) {
                break
            }
        }
        return final
    }


    const transcriptHandler = async () => {
        if (!bot.tsconfig.sendTranscripts.enableChannel && !bot.tsconfig.sendTranscripts.enableDM) return false

        const APIEvents = require("../api/modules/events")
        const messages = await getmessages(channel,5000)
        await require("../transcriptSystem/manager")(messages,guild,channel,user,reason)
        APIEvents.onTranscriptCreation(messages,channel,guild,new Date())
    }
    const deleteHandler = async () => {
        if (deleteRequired){
            pendingDelete.shift()
            //delete HIDDENDATA
            storage.delete("HIDDENDATA",channel.id)

            await channel.delete()
        }
    }
    if (mode == "delete" || mode == "deletenotranscript") await transcriptHandler()
    deleteHandler()
}