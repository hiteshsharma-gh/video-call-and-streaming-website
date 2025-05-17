'use client'

const ws = new WebSocket('ws://localhost:8000')

ws.onopen = () => {
  console.log('Connected to signaling server')
}
export default function Stream() {
  return (
    <div>
      stream
    </div>
  )
}
