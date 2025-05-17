'use client'

import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex h-screen justify-center items-center space-x-5">
      <Link href='/stream'><Button>stream</Button></Link>
      <Link href='/watch'><Button>watch</Button></Link>
    </div>
  );
}
