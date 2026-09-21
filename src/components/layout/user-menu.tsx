"use client";

import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { LogOut, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useCurrentMember } from "@/lib/hooks/use-current-member";

export function UserMenu() {
  const { data: member } = useCurrentMember();
  const { theme, setTheme } = useTheme();

  const firstName = member?.user.firstName ?? "";
  const lastName = member?.user.lastName ?? "";
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  const fullName = `${firstName} ${lastName}`.trim();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-9 gap-2 px-2">
          <Avatar size="sm">
            {member?.user.profileImage && (
              <AvatarImage
                src={member.user.profileImage}
                alt={fullName}
              />
            )}
            <AvatarFallback className="bg-secondary text-secondary-foreground">
              {initials || "?"}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium lg:inline">
            {fullName || "Laden..."}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">{fullName}</p>
            {member?.organizationName && (
              <p className="text-xs text-muted-foreground">
                {member.organizationName}
              </p>
            )}
            {member?.user.email && (
              <p className="text-xs text-muted-foreground truncate">
                {member.user.email}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <Sun className="mr-2 size-4" />
          ) : (
            <Moon className="mr-2 size-4" />
          )}
          {theme === "dark" ? "Hellmodus" : "Dunkelmodus"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: "/login" })}
          variant="destructive"
        >
          <LogOut className="mr-2 size-4" />
          Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
