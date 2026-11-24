import {randomBytes} from 'node:crypto'

// The durable candidate is owned by life-core. Only in-flight body and
// single-use render claims live here; a new server boot cannot replay them.
export function createBubbleDelivery({bootId, now=Date.now, capable, announce}) {
  const pending=new Map()
  let disposed=false
  const missed=reason=>({ok:false,reason})
  function finish(row,result) {
    clearTimeout(row.timer)
    pending.delete(row.id)
    row.resolve(result)
  }
  function lookup({id,client,bootId:boot}={}) {
    if(disposed||boot!==bootId||!capable(client))return null
    const row=pending.get(id)
    if(!row)return null
    if(row.expiresAt<=now()){
      finish(row,missed('unconfirmed'))
      return null
    }
    return row
  }
  return {
    offer({id,message,expiresAt,isCurrent}) {
      if(disposed||typeof id!=='string'||!id||pending.has(id)||!Number.isFinite(expiresAt)||
         expiresAt<=now()||typeof message?.text!=='string'||!message.text||typeof isCurrent!=='function')
        return Promise.resolve(missed('unconfirmed'))
      return new Promise(resolve=>{
        const row={id,message,expiresAt,isCurrent,resolve}
        row.timer=setTimeout(()=>finish(row,missed('unconfirmed')),Math.min(120_000,expiresAt-now()))
        pending.set(id,row)
        try{announce({deliveryId:id})}catch{finish(row,missed('unconfirmed'))}
      })
    },
    claim(request) {
      const row=lookup(request)
      if(!row||row.claim)return missed('unavailable')
      let current=false
      try{current=row.isCurrent()===true}catch{}
      if(!current){
        finish(row,missed('withdrawn'))
        return missed('withdrawn')
      }
      row.client=request.client
      row.claim=randomBytes(24).toString('hex')
      return {ok:true,claim:row.claim,message:row.message,remainingMs:row.expiresAt-now()}
    },
    shown(request) {
      const row=lookup(request)
      if(!row?.claim||row.client!==request.client||row.claim!==request.claim)return missed('unavailable')
      finish(row,{ok:true,status:'shown',deliveryId:row.id,text:row.message.text,shownAt:now()})
      return {ok:true}
    },
    dispose() {
      disposed=true
      for(const row of pending.values())finish(row,missed(row.claim?'unconfirmed':'withdrawn'))
    },
  }
}
