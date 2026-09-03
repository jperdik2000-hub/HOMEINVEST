export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      blackjack_round_seats: {
        Row: {
          bet: number
          cards_pending: number
          created_at: string
          current_hand: number
          final_payout: number
          hands: Json
          id: string
          insurance_bet: number
          is_bot: boolean
          pending_kind: string | null
          round_id: string
          seat_index: number
          side_bet_21_3: number
          side_bet_21_3_payout: number
          side_bet_21_3_result: string | null
          side_bet_21_3_settled: boolean
          status: string
          table_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bet?: number
          cards_pending?: number
          created_at?: string
          current_hand?: number
          final_payout?: number
          hands?: Json
          id?: string
          insurance_bet?: number
          is_bot?: boolean
          pending_kind?: string | null
          round_id: string
          seat_index: number
          side_bet_21_3?: number
          side_bet_21_3_payout?: number
          side_bet_21_3_result?: string | null
          side_bet_21_3_settled?: boolean
          status?: string
          table_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bet?: number
          cards_pending?: number
          created_at?: string
          current_hand?: number
          final_payout?: number
          hands?: Json
          id?: string
          insurance_bet?: number
          is_bot?: boolean
          pending_kind?: string | null
          round_id?: string
          seat_index?: number
          side_bet_21_3?: number
          side_bet_21_3_payout?: number
          side_bet_21_3_result?: string | null
          side_bet_21_3_settled?: boolean
          status?: string
          table_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blackjack_round_seats_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "blackjack_rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blackjack_round_seats_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "blackjack_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      blackjack_rounds: {
        Row: {
          created_at: string
          current_seat: number | null
          dealer_cards: Json
          dealer_hidden: boolean
          deck: Json
          id: string
          insurance_offered: boolean
          settled_at: string | null
          status: string
          table_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_seat?: number | null
          dealer_cards?: Json
          dealer_hidden?: boolean
          deck?: Json
          id?: string
          insurance_offered?: boolean
          settled_at?: string | null
          status?: string
          table_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_seat?: number | null
          dealer_cards?: Json
          dealer_hidden?: boolean
          deck?: Json
          id?: string
          insurance_offered?: boolean
          settled_at?: string | null
          status?: string
          table_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blackjack_rounds_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "blackjack_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      blackjack_seats: {
        Row: {
          bot_name: string | null
          id: string
          is_bot: boolean
          joined_at: string
          seat_index: number
          table_id: string
          user_id: string | null
        }
        Insert: {
          bot_name?: string | null
          id?: string
          is_bot?: boolean
          joined_at?: string
          seat_index: number
          table_id: string
          user_id?: string | null
        }
        Update: {
          bot_name?: string | null
          id?: string
          is_bot?: boolean
          joined_at?: string
          seat_index?: number
          table_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blackjack_seats_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "blackjack_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      blackjack_table_invitations: {
        Row: {
          created_at: string
          invited_user_id: string
          table_id: string
        }
        Insert: {
          created_at?: string
          invited_user_id: string
          table_id: string
        }
        Update: {
          created_at?: string
          invited_user_id?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blackjack_table_invitations_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "blackjack_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      blackjack_tables: {
        Row: {
          created_at: string
          ended_at: string | null
          host_id: string
          id: string
          max_bet: number
          min_bet: number
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          host_id: string
          id?: string
          max_bet?: number
          min_bet?: number
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          host_id?: string
          id?: string
          max_bet?: number
          min_bet?: number
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      direct_chat_mutes: {
        Row: {
          chat_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_chat_mutes_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "direct_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_chat_reads: {
        Row: {
          chat_id: string
          last_read_at: string
          last_read_message_id: string | null
          user_id: string
        }
        Insert: {
          chat_id: string
          last_read_at?: string
          last_read_message_id?: string | null
          user_id: string
        }
        Update: {
          chat_id?: string
          last_read_at?: string
          last_read_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_chat_reads_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "direct_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_chats: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          user_high: string
          user_low: string
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          user_high: string
          user_low: string
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          user_high?: string
          user_low?: string
        }
        Relationships: []
      }
      direct_message_pins: {
        Row: {
          chat_id: string
          message_id: string
          pinned_at: string
          pinned_by: string | null
        }
        Insert: {
          chat_id: string
          message_id: string
          pinned_at?: string
          pinned_by?: string | null
        }
        Update: {
          chat_id?: string
          message_id?: string
          pinned_at?: string
          pinned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "direct_message_pins_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "direct_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_message_pins_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_messages: {
        Row: {
          body: string | null
          chat_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          id: string
          kind: string
          metadata: Json
          reply_to_id: string | null
          sender_id: string
        }
        Insert: {
          body?: string | null
          chat_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: string
          kind?: string
          metadata?: Json
          reply_to_id?: string | null
          sender_id: string
        }
        Update: {
          body?: string | null
          chat_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: string
          kind?: string
          metadata?: Json
          reply_to_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "direct_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      game_events: {
        Row: {
          amount: number
          chip_amount: number | null
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          metadata: Json
          night_id: string
          player_id: string | null
        }
        Insert: {
          amount?: number
          chip_amount?: number | null
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          metadata?: Json
          night_id: string
          player_id?: string | null
        }
        Update: {
          amount?: number
          chip_amount?: number | null
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          night_id?: string
          player_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_events_night_id_fkey"
            columns: ["night_id"]
            isOneToOne: false
            referencedRelation: "poker_nights"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          id: string
          invited_email: string
          invited_name: string | null
          invited_user_id: string | null
          night_id: string
          token: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_email: string
          invited_name?: string | null
          invited_user_id?: string | null
          night_id: string
          token?: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_email?: string
          invited_name?: string | null
          invited_user_id?: string | null
          night_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_night_id_fkey"
            columns: ["night_id"]
            isOneToOne: false
            referencedRelation: "poker_nights"
            referencedColumns: ["id"]
          },
        ]
      }
      night_chat_messages: {
        Row: {
          body: string | null
          chat_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          id: string
          kind: string
          metadata: Json
          reply_to_id: string | null
          sender_id: string | null
          system_event: string | null
        }
        Insert: {
          body?: string | null
          chat_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: string
          kind?: string
          metadata?: Json
          reply_to_id?: string | null
          sender_id?: string | null
          system_event?: string | null
        }
        Update: {
          body?: string | null
          chat_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: string
          kind?: string
          metadata?: Json
          reply_to_id?: string | null
          sender_id?: string | null
          system_event?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "night_chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "night_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "night_chat_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "night_chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      night_chat_mutes: {
        Row: {
          chat_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "night_chat_mutes_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "night_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      night_chat_pins: {
        Row: {
          chat_id: string
          message_id: string
          pinned_at: string
          pinned_by: string | null
        }
        Insert: {
          chat_id: string
          message_id: string
          pinned_at?: string
          pinned_by?: string | null
        }
        Update: {
          chat_id?: string
          message_id?: string
          pinned_at?: string
          pinned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "night_chat_pins_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "night_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "night_chat_pins_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "night_chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      night_chat_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "night_chat_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "night_chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      night_chat_reads: {
        Row: {
          chat_id: string
          last_read_at: string
          last_read_message_id: string | null
          user_id: string
        }
        Insert: {
          chat_id: string
          last_read_at?: string
          last_read_message_id?: string | null
          user_id: string
        }
        Update: {
          chat_id?: string
          last_read_at?: string
          last_read_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "night_chat_reads_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "night_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "night_chat_reads_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "night_chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      night_chats: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          night_id: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          night_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          night_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "night_chats_night_id_fkey"
            columns: ["night_id"]
            isOneToOne: true
            referencedRelation: "poker_nights"
            referencedColumns: ["id"]
          },
        ]
      }
      night_photos: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          night_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          night_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          night_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "night_photos_night_id_fkey"
            columns: ["night_id"]
            isOneToOne: false
            referencedRelation: "poker_nights"
            referencedColumns: ["id"]
          },
        ]
      }
      night_tv_sessions: {
        Row: {
          active: boolean
          active_photo: Json | null
          announcement: string | null
          code: string
          created_at: string
          created_by: string | null
          id: string
          night_id: string
          settings: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          active_photo?: Json | null
          announcement?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          night_id: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          active_photo?: Json | null
          announcement?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          night_id?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "night_tv_sessions_night_id_fkey"
            columns: ["night_id"]
            isOneToOne: true
            referencedRelation: "poker_nights"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          chat_message: boolean
          invite_received: boolean
          new_night: boolean
          reminder_1h: boolean
          reminder_24h: boolean
          results_posted: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_message?: boolean
          invite_received?: boolean
          new_night?: boolean
          reminder_1h?: boolean
          reminder_24h?: boolean
          results_posted?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_message?: boolean
          invite_received?: boolean
          new_night?: boolean
          reminder_1h?: boolean
          reminder_24h?: boolean
          results_posted?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          event: string
          id: string
          read_at: string | null
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          event: string
          id?: string
          read_at?: string | null
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          event?: string
          id?: string
          read_at?: string | null
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      player_results: {
        Row: {
          award: string | null
          buy_in: number
          cash_out: number
          created_at: string
          final_rank: number | null
          id: string
          net_result: number | null
          night_id: string
          notes: string | null
          player_name: string
          rebuys: number
          user_id: string | null
        }
        Insert: {
          award?: string | null
          buy_in?: number
          cash_out?: number
          created_at?: string
          final_rank?: number | null
          id?: string
          net_result?: number | null
          night_id: string
          notes?: string | null
          player_name: string
          rebuys?: number
          user_id?: string | null
        }
        Update: {
          award?: string | null
          buy_in?: number
          cash_out?: number
          created_at?: string
          final_rank?: number | null
          id?: string
          net_result?: number | null
          night_id?: string
          notes?: string | null
          player_name?: string
          rebuys?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_results_night_id_fkey"
            columns: ["night_id"]
            isOneToOne: false
            referencedRelation: "poker_nights"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_hand_actions: {
        Row: {
          action: string
          amount: number
          created_at: string
          hand_id: string
          id: string
          seat_index: number
          seq: number
          street: string | null
        }
        Insert: {
          action: string
          amount?: number
          created_at?: string
          hand_id: string
          id?: string
          seat_index: number
          seq: number
          street?: string | null
        }
        Update: {
          action?: string
          amount?: number
          created_at?: string
          hand_id?: string
          id?: string
          seat_index?: number
          seq?: number
          street?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "poker_hand_actions_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "poker_hands"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_hand_seats: {
        Row: {
          all_in: boolean
          committed_hand: number
          committed_street: number
          folded: boolean
          hand_id: string
          has_acted: boolean
          last_action: string | null
          seat_index: number
          stack: number
          starting_stack: number
          user_id: string
        }
        Insert: {
          all_in?: boolean
          committed_hand?: number
          committed_street?: number
          folded?: boolean
          hand_id: string
          has_acted?: boolean
          last_action?: string | null
          seat_index: number
          stack: number
          starting_stack: number
          user_id: string
        }
        Update: {
          all_in?: boolean
          committed_hand?: number
          committed_street?: number
          folded?: boolean
          hand_id?: string
          has_acted?: boolean
          last_action?: string | null
          seat_index?: number
          stack?: number
          starting_stack?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poker_hand_seats_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "poker_hands"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_hands: {
        Row: {
          board: string[]
          current_bet: number
          current_seat: number | null
          deadline: string | null
          dealer_seat: number
          discards: Json
          ended_at: string | null
          hand_no: number
          id: string
          min_raise: number
          pot: number
          side_pots: Json
          started_at: string
          status: string
          street: string
          table_id: string
          turn_deadline: string | null
          variant: string
          winners: Json | null
        }
        Insert: {
          board?: string[]
          current_bet?: number
          current_seat?: number | null
          deadline?: string | null
          dealer_seat: number
          discards?: Json
          ended_at?: string | null
          hand_no: number
          id?: string
          min_raise?: number
          pot?: number
          side_pots?: Json
          started_at?: string
          status?: string
          street?: string
          table_id: string
          turn_deadline?: string | null
          variant?: string
          winners?: Json | null
        }
        Update: {
          board?: string[]
          current_bet?: number
          current_seat?: number | null
          deadline?: string | null
          dealer_seat?: number
          discards?: Json
          ended_at?: string | null
          hand_no?: number
          id?: string
          min_raise?: number
          pot?: number
          side_pots?: Json
          started_at?: string
          status?: string
          street?: string
          table_id?: string
          turn_deadline?: string | null
          variant?: string
          winners?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "poker_hands_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_hole_cards: {
        Row: {
          cards: string[]
          hand_id: string
          mucked: boolean
          revealed: boolean
          seat_index: number
          user_id: string
        }
        Insert: {
          cards: string[]
          hand_id: string
          mucked?: boolean
          revealed?: boolean
          seat_index: number
          user_id: string
        }
        Update: {
          cards?: string[]
          hand_id?: string
          mucked?: boolean
          revealed?: boolean
          seat_index?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poker_hole_cards_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "poker_hands"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_nights: {
        Row: {
          addon_amount: number
          addon_chips: number
          blind_levels: Json
          buy_in: number
          buy_in_chips: number
          clock_paused_at: string | null
          created_at: string
          currency: string
          current_level: number
          format: string
          host_id: string
          id: string
          level_minutes: number
          level_started_at: string | null
          location: string | null
          location_address: string | null
          location_lat: number | null
          location_lng: number | null
          location_place_id: string | null
          notes: string | null
          payout_split: Json
          rebuy_amount: number
          rebuy_chips: number
          rebuy_manager_id: string | null
          started_at: string | null
          starting_stack: number
          starts_at: string
          status: string
          title: string
          tournament_status: string
          updated_at: string
        }
        Insert: {
          addon_amount?: number
          addon_chips?: number
          blind_levels?: Json
          buy_in?: number
          buy_in_chips?: number
          clock_paused_at?: string | null
          created_at?: string
          currency?: string
          current_level?: number
          format?: string
          host_id: string
          id?: string
          level_minutes?: number
          level_started_at?: string | null
          location?: string | null
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          location_place_id?: string | null
          notes?: string | null
          payout_split?: Json
          rebuy_amount?: number
          rebuy_chips?: number
          rebuy_manager_id?: string | null
          started_at?: string | null
          starting_stack?: number
          starts_at: string
          status?: string
          title: string
          tournament_status?: string
          updated_at?: string
        }
        Update: {
          addon_amount?: number
          addon_chips?: number
          blind_levels?: Json
          buy_in?: number
          buy_in_chips?: number
          clock_paused_at?: string | null
          created_at?: string
          currency?: string
          current_level?: number
          format?: string
          host_id?: string
          id?: string
          level_minutes?: number
          level_started_at?: string | null
          location?: string | null
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          location_place_id?: string | null
          notes?: string | null
          payout_split?: Json
          rebuy_amount?: number
          rebuy_chips?: number
          rebuy_manager_id?: string | null
          started_at?: string | null
          starting_stack?: number
          starts_at?: string
          status?: string
          title?: string
          tournament_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      poker_rebuy_requests: {
        Row: {
          amount: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          status: string
          table_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          status?: string
          table_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          status?: string
          table_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poker_rebuy_requests_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_seats: {
        Row: {
          bot_name: string | null
          id: string
          is_bot: boolean
          joined_at: string
          seat_index: number
          stack: number
          status: string
          table_id: string
          time_bank_seconds: number
          total_buy_in: number
          user_id: string
        }
        Insert: {
          bot_name?: string | null
          id?: string
          is_bot?: boolean
          joined_at?: string
          seat_index: number
          stack: number
          status?: string
          table_id: string
          time_bank_seconds?: number
          total_buy_in?: number
          user_id: string
        }
        Update: {
          bot_name?: string | null
          id?: string
          is_bot?: boolean
          joined_at?: string
          seat_index?: number
          stack?: number
          status?: string
          table_id?: string
          time_bank_seconds?: number
          total_buy_in?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poker_seats_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_table_invitations: {
        Row: {
          created_at: string
          id: string
          invited_user_id: string
          table_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_user_id: string
          table_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_user_id?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poker_table_invitations_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_tables: {
        Row: {
          big_blind: number
          buy_in: number
          created_at: string
          ended_at: string | null
          game_mode: string
          host_id: string
          id: string
          max_seats: number
          name: string
          paused: boolean
          settlement: Json | null
          small_blind: number
          status: string
          updated_at: string
        }
        Insert: {
          big_blind?: number
          buy_in?: number
          created_at?: string
          ended_at?: string | null
          game_mode?: string
          host_id: string
          id?: string
          max_seats?: number
          name: string
          paused?: boolean
          settlement?: Json | null
          small_blind?: number
          status?: string
          updated_at?: string
        }
        Update: {
          big_blind?: number
          buy_in?: number
          created_at?: string
          ended_at?: string | null
          game_mode?: string
          host_id?: string
          id?: string
          max_seats?: number
          name?: string
          paused?: boolean
          settlement?: Json | null
          small_blind?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      poker_wallet_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          id: string
          kind: string
          note: string | null
          settled: boolean
          settled_at: string | null
          settled_by: string | null
          settlement_id: string | null
          table_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          settled?: boolean
          settled_at?: string | null
          settled_by?: string | null
          settlement_id?: string | null
          table_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          settled?: boolean
          settled_at?: string | null
          settled_by?: string | null
          settlement_id?: string | null
          table_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poker_wallet_transactions_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      poker_wallets: {
        Row: {
          chips: number
          created_at: string
          eligible_to_withdraw: number
          updated_at: string
          user_id: string
        }
        Insert: {
          chips?: number
          created_at?: string
          eligible_to_withdraw?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          chips?: number
          created_at?: string
          eligible_to_withdraw?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          name: string
          nickname: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          id: string
          name: string
          nickname?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          nickname?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reminder_log: {
        Row: {
          id: string
          kind: string
          night_id: string
          sent_at: string
        }
        Insert: {
          id?: string
          kind: string
          night_id: string
          sent_at?: string
        }
        Update: {
          id?: string
          kind?: string
          night_id?: string
          sent_at?: string
        }
        Relationships: []
      }
      rsvps: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string | null
          night_id: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name?: string | null
          night_id: string
          status: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          night_id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rsvps_night_id_fkey"
            columns: ["night_id"]
            isOneToOne: false
            referencedRelation: "poker_nights"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_payments: {
        Row: {
          amount: number
          created_at: string
          from_name: string
          from_user_id: string | null
          id: string
          night_id: string
          paid: boolean
          paid_at: string | null
          to_name: string
          to_user_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          from_name: string
          from_user_id?: string | null
          id?: string
          night_id: string
          paid?: boolean
          paid_at?: string | null
          to_name: string
          to_user_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          from_name?: string
          from_user_id?: string | null
          id?: string
          night_id?: string
          paid?: boolean
          paid_at?: string | null
          to_name?: string
          to_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_payments_night_id_fkey"
            columns: ["night_id"]
            isOneToOne: false
            referencedRelation: "poker_nights"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount: number
          confirmed_received_at: string | null
          created_at: string
          created_by: string | null
          creditor_id: string
          debtor_id: string
          dispute_reason: string | null
          id: string
          marked_paid_at: string | null
          payment_method: string | null
          payment_note: string | null
          session_name: string
          source_kind: Database["public"]["Enums"]["settlement_source"]
          source_table_id: string | null
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
          withdrawn_amount: number
        }
        Insert: {
          amount: number
          confirmed_received_at?: string | null
          created_at?: string
          created_by?: string | null
          creditor_id: string
          debtor_id: string
          dispute_reason?: string | null
          id?: string
          marked_paid_at?: string | null
          payment_method?: string | null
          payment_note?: string | null
          session_name: string
          source_kind: Database["public"]["Enums"]["settlement_source"]
          source_table_id?: string | null
          status?: Database["public"]["Enums"]["settlement_status"]
          updated_at?: string
          withdrawn_amount?: number
        }
        Update: {
          amount?: number
          confirmed_received_at?: string | null
          created_at?: string
          created_by?: string | null
          creditor_id?: string
          debtor_id?: string
          dispute_reason?: string | null
          id?: string
          marked_paid_at?: string | null
          payment_method?: string | null
          payment_note?: string | null
          session_name?: string
          source_kind?: Database["public"]["Enums"]["settlement_source"]
          source_table_id?: string | null
          status?: Database["public"]["Enums"]["settlement_status"]
          updated_at?: string
          withdrawn_amount?: number
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      table_messages: {
        Row: {
          body: string
          bot_name: string | null
          created_at: string
          id: string
          is_bot: boolean
          table_id: string
          user_id: string | null
        }
        Insert: {
          body: string
          bot_name?: string | null
          created_at?: string
          id?: string
          is_bot?: boolean
          table_id: string
          user_id?: string | null
        }
        Update: {
          body?: string
          bot_name?: string | null
          created_at?: string
          id?: string
          is_bot?: boolean
          table_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_messages_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "poker_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_entries: {
        Row: {
          addons: number
          buy_ins: number
          chips: number
          created_at: string
          eliminated_at: string | null
          id: string
          knocked_out_by: string | null
          night_id: string
          place: number | null
          player_name: string
          rebuys: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          addons?: number
          buy_ins?: number
          chips?: number
          created_at?: string
          eliminated_at?: string | null
          id?: string
          knocked_out_by?: string | null
          night_id: string
          place?: number | null
          player_name: string
          rebuys?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          addons?: number
          buy_ins?: number
          chips?: number
          created_at?: string
          eliminated_at?: string | null
          id?: string
          knocked_out_by?: string | null
          night_id?: string
          place?: number | null
          player_name?: string
          rebuys?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_entries_night_id_fkey"
            columns: ["night_id"]
            isOneToOne: false
            referencedRelation: "poker_nights"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      withdrawal_allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          settlement_id: string
          user_id: string
          withdrawal_tx_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          settlement_id: string
          user_id: string
          withdrawal_tx_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          settlement_id?: string
          user_id?: string
          withdrawal_tx_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_allocations_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_allocations_withdrawal_tx_id_fkey"
            columns: ["withdrawal_tx_id"]
            isOneToOne: false
            referencedRelation: "poker_wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_reset_casino: { Args: never; Returns: undefined }
      can_access_night_chat: { Args: { _chat: string }; Returns: boolean }
      can_access_night_photo_path: { Args: { path: string }; Returns: boolean }
      can_view_blackjack_table: { Args: { _table: string }; Returns: boolean }
      can_view_night: { Args: { _night: string }; Returns: boolean }
      can_view_poker_table: { Args: { _table: string }; Returns: boolean }
      current_user_email: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_or_create_direct_chat: { Args: { _other: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_direct_chat_participant: { Args: { _chat: string }; Returns: boolean }
      is_direct_message_participant: {
        Args: { _msg: string }
        Returns: boolean
      }
      is_night_admin: { Args: { _night: string }; Returns: boolean }
      is_night_admin_for_photo_path: {
        Args: { path: string }
        Returns: boolean
      }
      is_night_chat_admin: { Args: { _chat: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      night_chat_is_open: { Args: { _chat: string }; Returns: boolean }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      shares_night_with: { Args: { _other: string }; Returns: boolean }
      tv_session_active: { Args: { _night: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
      settlement_source: "poker" | "blackjack"
      settlement_status:
        | "unpaid"
        | "payment_marked_sent"
        | "payment_confirmed"
        | "partially_withdrawn"
        | "fully_withdrawn"
        | "disputed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      settlement_source: ["poker", "blackjack"],
      settlement_status: [
        "unpaid",
        "payment_marked_sent",
        "payment_confirmed",
        "partially_withdrawn",
        "fully_withdrawn",
        "disputed",
        "cancelled",
      ],
    },
  },
} as const
