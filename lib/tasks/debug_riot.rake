# frozen_string_literal: true

# Debug Riot API rank fetching. Usage:
#   bundle exec rake debug_riot[GameName,1234,na]
namespace :debug_riot do
  desc "Test Riot API rank fetch for a player (game_name,tag_line,region)"
  task :ranks, [:game_name, :tag_line, :region] => :environment do |_t, args|
    game_name = args[:game_name] || ENV["GAME_NAME"]
    tag_line = args[:tag_line] || ENV["TAG_LINE"]
    region_slug = (args[:region] || ENV["REGION"] || "na").to_s.downcase

    unless game_name.present? && tag_line.present?
      puts "Usage: rake debug_riot:ranks[GameName,1234,na]"
      puts "   or: GAME_NAME=x TAG_LINE=y REGION=na rake debug_riot:ranks"
      exit 1
    end

    riot_region = RegionMapping.riot_region(region_slug)
    puts "Region: #{region_slug} -> #{riot_region}"

    client = RiotClient.new

    # 1. Get account
    puts "\n1. Fetching account..."
    account = client.fetch_account_by_riot_id(
      game_name: game_name, tag_line: tag_line, region: riot_region
    )
    puuid = account[:puuid]
    puts "   PUUID: #{puuid[0..20]}..."

    # 2. Get summoner
    puts "\n2. Fetching summoner..."
    summoner_result = client.fetch_summoner_by_puuid(puuid: puuid, region: riot_region)
    summoner_data = summoner_result[:data]
    platform = summoner_result[:platform]
    summoner_id = summoner_data[:id]
    puts "   Platform: #{platform}"
    puts "   Summoner ID: #{summoner_id[0..20]}..."
    puts "   Level: #{summoner_data[:summonerLevel]}"

    # 3. Get league entries (with platform)
    puts "\n3. Fetching league entries (platform=#{platform})..."
    entries = client.fetch_league_entries(
      summoner_id: summoner_id, region: riot_region, platform: platform
    )
    puts "   Count: #{entries.size}"
    entries.each_with_index do |e, i|
      qt = e["queueType"] || e[:queueType]
      tier = e["tier"] || e[:tier]
      rank = e["rank"] || e[:rank]
      lp = e["leaguePoints"] || e[:leaguePoints]
      puts "   [#{i}] queueType=#{qt} tier=#{tier} rank=#{rank} lp=#{lp}"
    end

    # 4. Try without platform (fallback)
    if entries.empty?
      puts "\n4. Retrying without platform (all platforms)..."
      entries = client.fetch_league_entries_by_puuid(
        puuid: puuid, region: riot_region, platform: nil
      )
      puts "   Count: #{entries.size}"
      entries.each_with_index do |e, i|
        qt = e["queueType"] || e[:queueType]
        tier = e["tier"] || e[:tier]
        puts "   [#{i}] queueType=#{qt} tier=#{tier}"
      end
    end
  end
end
