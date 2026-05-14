import { UIMessage } from '@messages/sender'

mg.showUI(__html__)

mg.ui.onmessage = (msg: { type: UIMessage, data: any }) => {
  const { type, data } = msg
  if (type === UIMessage.HELLO) {
    const textNode = mg.createText()
    textNode.characters = data
  }
}