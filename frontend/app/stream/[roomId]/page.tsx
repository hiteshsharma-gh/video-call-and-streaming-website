'use client'

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { useParams } from "next/navigation";
import { useSignalingServer } from "@/utils/signaling";

export default function Room() {
  const params = useParams<{ roomId: string }>()
  const { roomId } = params
  const { localVideoRef, videoRefs, consumerList } = useSignalingServer(roomId)

  return (
    < div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" >
      <Card>
        <CardContent>
          <video ref={localVideoRef} autoPlay playsInline muted />
        </CardContent>
      </Card>

      {
        Object.keys(consumerList).map((key, index) => (
          <Card key={index}>
            <CardContent>
              <video
                key={index}
                ref={videoRefs[index]}
                autoPlay
                playsInline
                muted
              />
            </CardContent>
            <CardTitle className="text-center">{key}</CardTitle>
          </Card>
        ))
      }
    </div >);
}
