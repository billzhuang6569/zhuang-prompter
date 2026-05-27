import { RoomClient } from "../_components/room-client";
import { ScriptPreviewDemo } from "../_components/script-preview-demo";

type PageProps = {
  params: Promise<{
    roomCode: string;
  }>;
};

export default async function ControlPage({ params }: PageProps) {
  const { roomCode } = await params;
  return (
    <>
      <RoomClient roomCode={roomCode} mode="control" />
      <ScriptPreviewDemo variant="control" />
    </>
  );
}
