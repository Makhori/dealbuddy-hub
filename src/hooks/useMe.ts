import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Employee = {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  position_title: string;
  salary: number;
  base_rate: number;
  min_coef: number;
  target_coef: number;
  is_active: boolean;
};

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) return null;
      const [{ data: roles }, { data: employee }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase
          .from("employees")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      const isAdmin = (roles ?? []).some((r) => r.role === "admin");
      return {
        userId: user.id,
        email: user.email ?? "",
        isAdmin,
        employee: (employee as Employee | null) ?? null,
      };
    },
  });
}

export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("*")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Employee[];
    },
  });
}
