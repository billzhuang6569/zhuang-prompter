import { RoomClient } from "../_components/room-client";
import { extensionSpecFixture, parseMarkdown } from "@/modules/script-engine";

type PageProps = {
  params: Promise<{
    roomCode: string;
  }>;
};

export default async function PlayerPage({ params }: PageProps) {
  const { roomCode } = await params;
  const bundle = parseMarkdown(extensionSpecFixture, { scriptVersionId: "fixture_m1" });
  return <RoomClient roomCode={roomCode} mode="player" bundle={bundle} />;
}
