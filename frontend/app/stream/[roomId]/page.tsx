'use client'

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { useParams } from "next/navigation";
import useSignalingServer from "@/utils/signaling";

export default function Room() {
  const params = useParams<{ roomId: string }>()
  const { roomId } = params
  const { localVideoRef, videoRefs, consumerList } = useSignalingServer(roomId)

  return (
    <main>
      < div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" >
        <Card>
          <CardContent>
            <video ref={localVideoRef} autoPlay playsInline muted />
          </CardContent>
          <CardTitle className="text-center">You (local)</CardTitle>
        </Card>

        {
          Object.keys(consumerList).map((producerId) => (
            <Card key={producerId}>
              <CardContent>
                <video
                  ref={videoRefs[producerId]}
                  autoPlay
                  playsInline
                />
              </CardContent>
              <CardTitle className="text-center">{producerId}</CardTitle>
            </Card>
          ))
        }

      </div >
    </main>)
}
