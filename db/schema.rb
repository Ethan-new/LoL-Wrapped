# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_02_25_212521) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "matches", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "game_start_at", null: false
    t.string "match_uid", null: false
    t.jsonb "raw_json", default: {}
    t.string "region", null: false
    t.datetime "updated_at", null: false
    t.integer "year", null: false
    t.index ["match_uid"], name: "index_matches_on_match_uid", unique: true
    t.index ["region", "year"], name: "index_matches_on_region_and_year"
    t.index ["year"], name: "index_matches_on_year"
  end

  create_table "players", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "last_synced_at"
    t.integer "profile_icon_id"
    t.string "puuid", null: false
    t.jsonb "rank_entries", default: []
    t.jsonb "recap_failure_reasons", default: {}
    t.jsonb "recap_statuses", default: {}
    t.string "region"
    t.bigint "revision_date"
    t.string "riot_id"
    t.string "summoner_id"
    t.integer "summoner_level"
    t.datetime "updated_at", null: false
    t.jsonb "year_match_ids", default: {}
    t.index ["puuid"], name: "index_players_on_puuid", unique: true
  end

  create_table "recap_year_stats", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.jsonb "enemy_team_bans", default: []
    t.jsonb "extra_stats", default: {}
    t.jsonb "fav_items", default: []
    t.jsonb "most_beat_us", default: []
    t.jsonb "most_played_with", default: []
    t.jsonb "our_team_bans", default: []
    t.jsonb "ping_breakdown", default: {}
    t.bigint "player_id", null: false
    t.bigint "total_assists", default: 0, null: false
    t.bigint "total_deaths", default: 0, null: false
    t.bigint "total_game_seconds", default: 0, null: false
    t.bigint "total_gold_spent", default: 0, null: false
    t.bigint "total_kills", default: 0, null: false
    t.integer "total_pings", default: 0, null: false
    t.datetime "updated_at", null: false
    t.integer "year", null: false
    t.index ["player_id", "year"], name: "index_recap_year_stats_on_player_id_and_year", unique: true
    t.index ["player_id"], name: "index_recap_year_stats_on_player_id"
  end

  add_foreign_key "recap_year_stats", "players"
end
