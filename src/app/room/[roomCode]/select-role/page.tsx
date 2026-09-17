import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{
    roomCode: string;
  }>;
};

// 加入即播放端（§12.3）：历史上的角色确认页现在直接跳转到播放端，
// 保证任何指向 /select-role 的旧链接、书签或扫码也不再出现中间确认步骤。
export default async function SelectRolePage({ params }: PageProps) {
  const { roomCode } = await params;
  redirect(`/room/${roomCode}/player`);
}
