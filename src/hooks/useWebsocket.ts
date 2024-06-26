import { emit, listen } from '@tauri-apps/api/event'

import type { UnlistenFn } from '@tauri-apps/api/event'

import { getLiveTokenApi } from '@/apis/live'
import { WEBSOCKET_URL } from '@/utils/constants'
import {
  BARRAGE_MESSAGE_EVENT,
  CLOSE_WEBSOCKET_EVENT,
  CONNECT_SUCCESS_EVENT,
  GIFT_EVENT,
  OPEN_WEBSOCKET_EVENT,
  POPULARITY_EVENT,
  RANK_EVENT,
  SUPER_CHAT_EVENT,
  WELCOME_EVENT,
} from '@/utils/events'
import handleMessage from '@/utils/message'
import { decode, encode } from '@/utils/tools'

let websocket: WebSocket | null = null
let timer = null as any

function useWebsocket() {
  const messageEmits = async (messages: any[]) => {
    if (!messages || !Array.isArray(messages) || !messages.length)
      return

    const result = await handleMessage(messages)
    if (!result)
      return

    const { rankList, barrageList, giftList, welcomeList, superChatList }
      = result

    // 针对不同的信息类型，分别发出事件
    if (rankList && rankList.length)
      emit(RANK_EVENT, rankList)
    if (barrageList && barrageList.length)
      emit(BARRAGE_MESSAGE_EVENT, barrageList)
    if (giftList && giftList.length)
      emit(GIFT_EVENT, giftList)
    if (welcomeList && welcomeList.length)
      emit(WELCOME_EVENT, welcomeList)
    if (superChatList && superChatList.length)
      emit(SUPER_CHAT_EVENT, superChatList)
  }

  // 发送连接信息
  const onConnect = async (roomid: number) => {
    if (!websocket)
      return

    // 连接前获取key
    const { data } = await getLiveTokenApi()
    const { currentUser } = useAppStore()
    const authData = {
      uid: currentUser?.mid,
      roomid,
      protover: 2,
      type: 2,
      platform: 'web',
      key: data.token,
    }

    websocket.send(
      encode(
        JSON.stringify(authData),
        7,
      ),
    )

    // 初始化人气
    websocket.send(encode('', 2))

    // 发送心跳
    timer = setInterval(() => {
      websocket && websocket.send(encode('', 2))
    }, 30000)
  }

  // 接收弹幕信息
  const onMessage = async (msgEvent: any) => {
    if (!websocket)
      return

    if (websocket.readyState === 3)
      return websocket.close()

    const result: any = await decode(msgEvent.data)

    switch (result.op) {
      case 3:
        // 发出人气信息
        await emit(POPULARITY_EVENT, result.body.count)
        break
      case 5:
        messageEmits(result.body)
        break
      case 8:
        await emit(CONNECT_SUCCESS_EVENT)
        break
      default:
        console.warn('没有捕获的op', result)
        break
    }
  }

  // 关闭长链接
  const closeWebsocket = () => {
    timer && clearInterval(timer)
    websocket && websocket?.close()
    websocket = null
  }

  // 开启长链接
  const openWebsocket = (roomid: number) => {
    closeWebsocket()

    websocket = new WebSocket(WEBSOCKET_URL)

    websocket.onopen = () => {
      websocket && websocket.readyState === websocket.OPEN && onConnect(roomid)
    }

    websocket.onmessage = msgEvent => onMessage(msgEvent)

    websocket.onerror = () => openWebsocket(roomid)
  }

  const unListeners: UnlistenFn[] = []
  const trigger = async () => {
    const startListener = await listen<string>(OPEN_WEBSOCKET_EVENT, async (event) => {
      closeWebsocket()

      const roomid = event.payload

      openWebsocket(Number.parseInt(roomid))
    })
    const stopListener = await listen(CLOSE_WEBSOCKET_EVENT, closeWebsocket)
    unListeners.push(startListener, stopListener)
  }

  return { trigger }
}

export default useWebsocket
