# frozen_string_literal: true

# Debug match structure and ComputeMostPlayedWithJob.
# Usage:
#   bundle exec rake debug_match:inspect[player_id,year]
#   bundle exec rake debug_match:inspect_match[match_uid]
namespace :debug_match do
  desc "Inspect match structure for a stored match (match_uid)"
  task :inspect_match, [ :match_uid ] => :environment do |_t, args|
    match_uid = args[:match_uid] || ENV["MATCH_UID"]
    unless match_uid.present?
      puts "Usage: MATCH_UID=NA1_123 rake debug_match:inspect_match"
      puts "   or: rake debug_match:inspect_match[NA1_123]"
      exit 1
    end

    match = Match.find_by(match_uid: match_uid)
    unless match
      puts "Match #{match_uid} not found in DB"
      exit 1
    end

    raw = match.raw_json || {}
    puts "Match #{match_uid}:"
    puts "  Top-level keys: #{raw.keys.inspect}"
    info = raw["info"] || raw[:info]
    if info
      puts "  info keys: #{info.keys.inspect}"
      participants = info["participants"] || info[:participants]
      puts "  participants count: #{Array(participants).size}"
      if participants.any?
        p = Array(participants).first
        puts "  First participant keys: #{p.keys.inspect}"
        puts "  puuid: #{p['puuid'] || p[:puuid]}"
        puts "  teamId: #{p['teamId'] || p[:teamId]}"
        puts "  win: #{p['win'] || p[:win]}"
      end
    else
      puts "  No 'info' key found"
    end
  end

  desc "Inspect player recap pipeline (player_id, year)"
  task :inspect, [ :player_id, :year ] => :environment do |_t, args|
    player_id = (args[:player_id] || ENV["PLAYER_ID"]).to_i
    year = (args[:year] || ENV["YEAR"] || Time.current.year).to_i

    unless player_id.positive?
      puts "Usage: PLAYER_ID=1 YEAR=2025 rake debug_match:inspect"
      exit 1
    end

    player = Player.find_by(id: player_id)
    unless player
      puts "Player #{player_id} not found"
      exit 1
    end

    match_uids = (player.year_match_ids || {}).dig(year.to_s) || []
    puts "Player #{player_id} (#{player.puuid[0..15]}...), year #{year}"
    puts "  year_match_ids count: #{match_uids.size}"

    matches_found = 0
    participants_with_puuid = 0
    match_uids.first(3).each do |match_uid|
      match = Match.find_by(match_uid: match_uid)
      if match
        matches_found += 1
        raw = match.raw_json || {}
        participants = raw.dig("info", "participants") || raw.dig(:info, :participants) || []
        found = participants.find { |p| (p["puuid"] || p[:puuid]) == player.puuid }
        participants_with_puuid += 1 if found
        puts "  Match #{match_uid}: #{match ? 'found' : 'MISSING'}, participants=#{participants.size}, player_in_match=#{found.present?}"
      else
        puts "  Match #{match_uid}: NOT IN DB"
      end
    end

    recap_count = RecapPerson.where(player_id: player_id, year: year).count
    puts "  RecapPerson count: #{recap_count}"
  end
end
