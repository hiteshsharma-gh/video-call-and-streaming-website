"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const [roomId, setRoomId] = useState<string>("")
  const router = useRouter()

  function handleCreate() {
    router.push(`/stream/${crypto.randomUUID()}`)
  }

  return (
    <div className="flex flex-col h-screen justify-center items-center space-y-10">
      <div className="flex flex-col space-y-5">
        <Input type="text" placeholder="roomId" value={roomId} onChange={(e) => { setRoomId(e.target.value) }} />
        <Button onClick={() => router.push(`/stream/${roomId}`)}>Join</Button>
      </div>
      <p>OR</p>
      <div>
        <Button onClick={handleCreate}>Create a room</Button>
      </div>
    </div>
  )
}
